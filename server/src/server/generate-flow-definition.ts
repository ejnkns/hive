/** @public — AI flow generation: description → design → validated spec →
 * rendered, gate-checked TypeScript definition, iterating against the gate
 * until it passes (or the attempt budget is spent).
 *
 * The hybrid design: the model emits a **structured FlowSpec** (JSON, in a
 * fenced block — the proxy chat path has no tool-call wiring, and JSON-in-a-
 * fence is provider-agnostic), the deterministic renderer turns it into TS
 * with the schema-consistency check's conventions structurally baked in, and
 * the gate — spec validation → render → transpile+load → schema-consistency
 * check → per-definition typecheck — feeds its failures back for a revised
 * spec, up to N attempts.
 *
 * The model never writes TypeScript, so convention drift is impossible; the
 * failures it iterates on are real semantic errors (unknown references, reads
 * without writers, writes to undeclared fields, type mismatches).
 *
 * Two stages, per the flow-authoring skill: a **design pass** first (entities,
 * lifecycles, patterns, error escape hatches — one model turn, kept in
 * context), then the **spec pass** iterating against the gate. Advisory
 * findings — spec-level anti-patterns (`analyzeFlowSpec`) and structural
 * soundness warnings from the schema check — are fed back too, so the model
 * fixes flows that "can never finish" rather than shipping them. */

import { buildFlowAuthoringPrompt } from "./flow-authoring";
import { loadDefinitionFromSource } from "./flow-definitions";
import { analyzeFlowSpec, type FlowSpec, validateFlowSpec } from "./flow-spec";
import { handleChatCompletion } from "./proxy/handle-chat-completion";
import { renderFlowDefinition } from "./render-flow-definition";
import { checkDefinitionSources } from "./schema-consistency";
import { consumeSseStream } from "./sse-consume";
import { typecheckDefinitionSource } from "./typecheck-definition";

// ─── the model caller seam ────────────────────────────────────────────

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Per-call hooks the loop forwards to the model caller so a long generation
// streams live progress to the UI: the raw model content as it arrives, and
// the abort signal (client disconnect) that should stop the provider call.
export type ModelCallCallbacks = {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

export type ModelCaller = (
  messages: ChatMessage[],
  callbacks?: ModelCallCallbacks
) => Promise<string>;

// The default caller: the proxy chat path, SSE-streamed.
async function defaultModelCaller(
  messages: ChatMessage[],
  callbacks?: ModelCallCallbacks
): Promise<string> {
  const result = await handleChatCompletion(
    { messages, stream: true },
    {},
    callbacks?.signal
  );
  if (!result.success || !result.stream) {
    throw new Error(result.error ?? "Model call failed");
  }
  let content = "";
  await consumeSseStream(
    result.stream,
    (delta) => {
      if (delta.content && typeof delta.content === "string") {
        content += delta.content;
        callbacks?.onDelta?.(delta.content);
      }
    },
    callbacks?.signal
  );
  return content;
}

// ─── the loop ─────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 4;

// Live progress events from the generation loop, streamed to the UI so a long
// generation shows what is actually happening instead of a bare spinner. The
// route ends the stream with `done` (the full result) or `error`.
export type GenerationProgressEvent =
  | {
      type: "stage";
      stage: "design" | "spec" | "validating" | "rendering" | "checking";
      attempt?: number;
      maxAttempts?: number;
    }
  | { type: "delta"; text: string }
  | {
      type: "attempt_failed";
      attempt: number;
      maxAttempts: number;
      errors: string[];
    }
  | { type: "warnings"; findings: string[] };

export type GenerationReport = {
  passed: boolean;
  attempts: number;
  errors: string[];
  warnings: string[];
};

export type GenerationResult = {
  source: string;
  report: GenerationReport;
};

export type GenerationOptions = {
  onProgress?: (event: GenerationProgressEvent) => void;
  signal?: AbortSignal;
};

export async function generateFlowDefinitionSource(
  prompt: string,
  options: GenerationOptions = {}
): Promise<GenerationResult> {
  return runGenerationLoop(
    prompt,
    modelCaller,
    MAX_ATTEMPTS,
    options.onProgress,
    options.signal
  );
}

// Test seam: replaces the model caller the route reaches through
// generateFlowDefinitionSource (the loop itself takes the caller as a
// parameter). Pass undefined to restore the default proxy path.
export function setGenerationModelCallerForTest(
  caller: ModelCaller | undefined
): void {
  modelCaller = caller ?? defaultModelCaller;
}

let modelCaller: ModelCaller = defaultModelCaller;

export async function runGenerationLoop(
  prompt: string,
  model: ModelCaller,
  maxAttempts: number = MAX_ATTEMPTS,
  onProgress?: (event: GenerationProgressEvent) => void,
  signal?: AbortSignal
): Promise<GenerationResult> {
  const emit = (event: GenerationProgressEvent) => onProgress?.(event);
  const callModel = (messages: ChatMessage[]): Promise<string> => {
    signal?.throwIfAborted();
    return model(messages, {
      onDelta: (text) => emit({ type: "delta", text }),
      signal,
    });
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildFlowAuthoringPrompt() },
    {
      role: "user",
      content: [
        "Design this flow first (entities and lifecycles, where AI is used, what each ai-task returns, how a human drives it, how workflows connect, the error escape hatch). Keep it to 3-8 bullet lines, then you will be asked for the spec.",
        "",
        `Request: ${prompt}`,
      ].join("\n"),
    },
  ];

  // Stage 1 — design. One model turn; the design stays in the conversation so
  // every spec attempt (and feedback round) revises against the same plan.
  emit({ type: "stage", stage: "design" });
  const design = await callModel(messages);
  messages.push({ role: "assistant", content: design });
  messages.push({
    role: "user",
    content:
      "Now produce the JSON FlowSpec for this design, in a single fenced code block. No prose outside the block.",
  });

  let bestSource: string | undefined;
  let lastErrors: string[] = [];
  let lastWarnings: string[] = [];

  // Stage 2 — the spec, iterated against the gate.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({
      type: "stage",
      stage: "spec",
      attempt,
      maxAttempts,
    });
    const content = await callModel(messages);
    messages.push({ role: "assistant", content });

    const spec = extractSpecJson(content);
    if (spec === undefined) {
      lastErrors = [
        "The model did not return a JSON flow spec in a fenced code block",
      ];
      lastWarnings = [];
      emit({
        type: "attempt_failed",
        attempt,
        maxAttempts,
        errors: lastErrors,
      });
    } else {
      emit({ type: "stage", stage: "validating" });
      const specErrors = validateFlowSpec(spec);
      const specWarnings = analyzeFlowSpec(spec);
      if (specErrors.length > 0) {
        lastErrors = specErrors.map((e) => `spec.${e.path}: ${e.message}`);
        lastWarnings = specWarnings;
        emit({
          type: "attempt_failed",
          attempt,
          maxAttempts,
          errors: lastErrors,
        });
      } else {
        emit({ type: "stage", stage: "rendering" });
        const source = renderFlowDefinition(spec);
        bestSource = source;

        emit({ type: "stage", stage: "checking" });
        const loadErrors = await tryLoad(source);
        if (loadErrors.length > 0) {
          lastErrors = loadErrors;
          lastWarnings = specWarnings;
          emit({
            type: "attempt_failed",
            attempt,
            maxAttempts,
            errors: lastErrors,
          });
        } else {
          const check = checkDefinitionSources([
            { path: "generated.ts", source },
          ]);
          const typeIssues = typecheckDefinitionSource(source, "__generate__");
          const errors = [
            ...check.errors,
            ...typeIssues.map(
              (i) => `typecheck ${i.line}:${i.column} — ${i.message}`
            ),
          ];
          if (errors.length === 0) {
            lastErrors = [];
            lastWarnings = [...specWarnings, ...check.warnings];
            // A clean spec passes immediately; one with advisory findings gets
            // a feedback round (and passes with warnings on the last attempt).
            if (lastWarnings.length === 0 || attempt === maxAttempts) {
              return {
                source,
                report: {
                  passed: true,
                  attempts: attempt,
                  errors: [],
                  warnings: lastWarnings,
                },
              };
            }
            emit({ type: "warnings", findings: lastWarnings });
          } else {
            lastErrors = errors;
            lastWarnings = [...specWarnings, ...check.warnings];
            emit({
              type: "attempt_failed",
              attempt,
              maxAttempts,
              errors: lastErrors,
            });
          }
        }
      }
    }

    const feedback = buildFeedback(lastErrors, lastWarnings);
    if (attempt < maxAttempts) {
      messages.push({ role: "user", content: feedback });
    }
  }

  if (bestSource !== undefined) {
    return {
      source: bestSource,
      report: {
        passed: false,
        attempts: maxAttempts,
        errors: lastErrors,
        warnings: lastWarnings,
      },
    };
  }
  throw new Error(
    `Generation failed after ${maxAttempts} attempts: ${lastErrors.join("; ")}`
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

async function tryLoad(source: string): Promise<string[]> {
  try {
    await loadDefinitionFromSource("__generate__", source);
    return [];
  } catch (err) {
    return [
      `The generated definition failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`,
    ];
  }
}

// Errors reject the spec and lead the feedback; warnings are advisory (the
// spec rendered) but the model gets one chance to fix them before generation
// passes with warnings reported.
function buildFeedback(errors: string[], warnings: string[]): string {
  if (errors.length > 0) {
    return [
      "Your previous spec was rejected. Fix every issue below and return a corrected JSON flow spec (same format, one fenced block). Do not argue; do not repeat the same mistakes.",
      "",
      ...errors.map((e) => `- ${e}`),
      ...(warnings.length > 0
        ? [
            "",
            "Advisory findings to fix along the way:",
            ...warnings.map((w) => `- ${w}`),
          ]
        : []),
    ].join("\n");
  }
  return [
    "Your previous spec validated and rendered, but has advisory findings. Fix them if they apply and return the corrected JSON flow spec (one fenced block). If a finding does not apply to your design, return the spec unchanged.",
    "",
    ...warnings.map((w) => `- ${w}`),
  ].join("\n");
}

function extractSpecJson(content: string): FlowSpec | undefined {
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? content).trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { workflows?: unknown }).workflows)
    ) {
      return parsed as FlowSpec;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
