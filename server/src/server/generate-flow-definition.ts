/** @public — AI flow generation: description → validated spec → rendered,
 * gate-checked TypeScript definition, iterating against the gate until it
 * passes (or the attempt budget is spent).
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
 * without writers, writes to undeclared fields, type mismatches). */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { loadDefinitionFromSource } from "./flow-definitions";
import { type FlowSpec, validateFlowSpec } from "./flow-spec";
import { handleChatCompletion } from "./proxy/handle-chat-completion";
import { renderFlowDefinition } from "./render-flow-definition";
import { checkDefinitionSources } from "./schema-consistency";
import { consumeSseStream } from "./sse-consume";
import { typecheckDefinitionSource } from "./typecheck-definition";

// ─── the model caller seam ────────────────────────────────────────────

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ModelCaller = (messages: ChatMessage[]) => Promise<string>;

// The default caller: the proxy chat path, SSE-streamed.
async function defaultModelCaller(messages: ChatMessage[]): Promise<string> {
  const result = await handleChatCompletion(
    { messages, stream: true },
    {},
    undefined
  );
  if (!result.success || !result.stream) {
    throw new Error(result.error ?? "Model call failed");
  }
  let content = "";
  await consumeSseStream(result.stream, (delta) => {
    if (delta.content && typeof delta.content === "string") {
      content += delta.content;
    }
  });
  return content;
}

// ─── prompt ───────────────────────────────────────────────────────────

const SPEC_SHAPE = `## FlowSpec shape (respond with ONLY this JSON, in one fenced code block)

{
  "id": "reviewFlow",              // valid TS identifier (camelCase)
  "label": "Review Flow",
  "description": "optional",
  "configSchema": [ { "key": "basePath", "label": "Base path", "type": "string", "required": true } ],
  "workflows": [ WORKFLOW, ... ],
  "edges": [ EDGE, ... ],          // optional
  "actions": [ FLOW_ACTION, ... ]  // optional
}

WORKFLOW: {
  "id": "cards",                   // valid identifier, unique per flow
  "label": "Cards",
  "instanceState": [ { "field": "verdict", "type": "string" } ],
  "initialState": "ready",         // one of the states
  "terminalStates": ["done"],
  "states": [ STATE, ... ],
  "instance": { "title": "cardSpec.title" },   // optional; dotted path into instanceState
  "ui": { "view": "board", "columns": [ { "id": "ready", "label": "Ready", "states": ["ready"] } ] },  // optional
  "display": { "fields": [ { "path": "cardSpec", "label": "Spec" } ] }                                  // optional
}

STATE: {
  "id": "running",
  "label": "Running",
  "category": "initial" | "active" | "terminal" | "error",
  "tasks": [ TASK, ... ],          // auto tasks that run on state entry
  "autoTransitions": [ { "to": "validating", "gate": GATE }, ... ],
  "actions": [ STATE_ACTION, ... ]
}

TASK: {
  "id": "runAgent",                // valid identifier, unique per workflow
  "label": "Run agent",
  "role": "operation" | "ai-task" | "ai-chat",
  "operations": ["prepare_worktree"],  // ENGINE op names only (capabilities list)
  "operationInputs": { "require": "committed" },   // verify_workspace: committed | changes | none
  "tools": ["read_file", "write_file", "run_command", "git_status", "git_diff", "git_log", "commit_work", "search_code", "list_directory", "git_show"],  // infrastructure tool names only
  "completionTool": "complete_task",   // the ONLY allowed completion tool
  "workspacePath": "@instance:worktreePath",  // literal dir or "@instance:<field>"
  "inputFromInstanceState": "brief",   // dotted path into instanceState, seeded as the first message
  "persist": { "path": "reviews/{instanceId}-{attempt}.json" },
  "patch": { "verdict": { "kind": "taskOutput", "task": "runAgent", "path": "output.verdict" } }  // OPERATION tasks only; writes instance state
}

STATE_ACTION: {
  "id": "accept", "label": "Accept",
  "variant": "primary" | "secondary" | "destructive" | "default",
  "transitionTo": "done",
  "gate": GATE,                     // optional
  "newAttempt": true,               // optional: engine bumps the attempt counter and discards the abandoned workspace
  "completesRunningTask": true,     // optional: a human "Done" ends a running ai-chat session; the transcript is the output
  "dependsOnState": "done",         // optional: engine blocks until instances reach this state
  "createInstance": { "workflowId": "cards", "fields": [ { "key": "title", "label": "Title", "type": "string", "required": true } ] }  // optional
}

FLOW_ACTION: { "id": "add_idea", "label": "Add idea", "variant": "primary",
  "createInstance": { "workflowId": "ideas", "fields": [ { "key": "title", "label": "Title", "type": "string", "required": true } ] },
  "dispatchToAll": { "workflowId": "requirements", "actionId": "start" } }   // either createInstance or dispatchToAll

GATE (structured predicates — NO expression language, one of):
  { "kind": "always" } | { "kind": "never" }
  { "kind": "hasRunningTask" } | { "kind": "noRunningTask" }
  { "kind": "taskSuccess", "task": "runAgent" } | { "kind": "taskError", "task": "runAgent" }
  { "kind": "taskOutputEquals", "task": "runAgent", "path": "output.completion.outcome", "value": "approved" }   // path MUST start with "output"
  { "kind": "instanceStateEquals", "field": "verdict", "value": "approved" }   // field declared in instanceState; scalar value must match its type
  { "kind": "errorCountAtLeast", "task": "validateCompletion", "count": 3 }
  { "kind": "not", "gate": GATE } | { "kind": "and", "gates": [ GATE, ... ] } | { "kind": "or", "gates": [ GATE, ... ] }

VALUE SOURCES (patch and edge field values):
  { "kind": "literal", "value": "approved" }   // string|number|boolean; must match the declared field type
  { "kind": "taskOutput", "task": "runAgent", "path": "output.verdict" }   // dotted path into the task's outcome
  { "kind": "instanceId" }                     // patch ops only, string fields only

EDGE: {
  "fromWorkflow": "plan", "fromStates": ["done"], "toWorkflow": "cards",
  "fields": { "title": { "kind": "taskOutput", "task": "planWork", "path": "output" } },   // optional
  "fanOut": { "task": "planWork", "path": "output.cards", "fields": { "title": { "kind": "itemPath", "path": "title" }, "dependsOn": { "kind": "itemPath", "path": "dependencies" } } }  // optional; one cards instance per array item
}

RULES:
- Every instance-state field that is READ (gates, instance/display hints, inputFromInstanceState, "@instance:" refs, dependsOnState) must have a WRITER: a patch op on an operation task, an edge field into that workflow, a createInstance payload key, or an engine op. Fields the engine provides (worktreePath, branchName, attempt) need no writer.
- Every write (patch key, edge field, createInstance key) must be declared in the target workflow's instanceState.
- Only engine operations and infrastructure tools from the capabilities list may be referenced.
- completionTool must be "complete_task".
- gate taskOutputEquals paths start with "output" (the task's output).
- Workflow/state/task/field/action ids must be valid TS identifiers (no dashes, no spaces).
- A workflow with no instance state uses an empty instanceState array.
- A task may declare either "patch" (operation role) or nothing extra; patch writes on a task read a SIBLING task's output (the patch op runs as an operation task after that task completes).`;

// A small but real reference flow: one workflow with an ai-chat session, a
// patch op recording the session's verdict, gates, and a flow-level
// createInstance action. Exercises the vocabulary the model must produce.
const REFERENCE_SPEC: FlowSpec = {
  id: "reviewFlow",
  label: "Review Flow",
  description: "A review flow with an AI session and a recorded verdict.",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
      instance: { title: "title" },
      instanceState: [
        { field: "title", type: "string" },
        { field: "verdict", type: "string" },
      ],
      initialState: "ready",
      terminalStates: ["approved", "rejected"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "start",
              label: "Start review",
              variant: "primary",
              transitionTo: "reviewing",
            },
          ],
        },
        {
          id: "reviewing",
          label: "Reviewing",
          category: "active",
          tasks: [
            {
              id: "session",
              label: "Review session",
              role: "ai-chat",
              startOnUserInput: true,
              completionTool: "complete_task",
            },
            {
              id: "recordVerdict",
              label: "Record verdict",
              role: "operation",
              patch: {
                verdict: {
                  kind: "taskOutput",
                  task: "session",
                  path: "output.verdict",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "decided",
              gate: { kind: "taskSuccess", task: "recordVerdict" },
            },
            {
              to: "rejected",
              gate: { kind: "taskError", task: "session" },
            },
          ],
        },
        {
          id: "decided",
          label: "Decided",
          category: "active",
          autoTransitions: [
            {
              to: "approved",
              gate: {
                kind: "instanceStateEquals",
                field: "verdict",
                value: "approved",
              },
            },
            {
              to: "rejected",
              gate: {
                kind: "instanceStateEquals",
                field: "verdict",
                value: "rejected",
              },
            },
          ],
        },
        { id: "approved", label: "Approved", category: "terminal" },
        { id: "rejected", label: "Rejected", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_review",
      label: "Add review",
      variant: "primary",
      createInstance: {
        workflowId: "review",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
        ],
      },
    },
  ],
  edges: [],
};

function buildSystemPrompt(): string {
  return [
    "You design flow definitions for the Hive workflow engine. The engine provides everything in the capabilities below for free; a flow only declares its domain.",
    "",
    authoringGuide(),
    "",
    SPEC_SHAPE,
    "",
    `## Reference flow (a valid spec)\n${JSON.stringify(REFERENCE_SPEC, null, 2)}`,
    "",
    "Respond with ONLY the JSON flow spec for the user's request, in a single fenced code block. No prose, no TypeScript.",
  ].join("\n");
}

// ─── the loop ─────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 4;

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

export async function generateFlowDefinitionSource(
  prompt: string
): Promise<GenerationResult> {
  return runGenerationLoop(prompt, modelCaller);
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
  maxAttempts: number = MAX_ATTEMPTS
): Promise<GenerationResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: prompt },
  ];

  let bestSource: string | undefined;
  let lastErrors: string[] = [];
  let lastWarnings: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const content = await model(messages);
    messages.push({ role: "assistant", content });

    const spec = extractSpecJson(content);
    if (spec === undefined) {
      lastErrors = [
        "The model did not return a JSON flow spec in a fenced code block",
      ];
    } else {
      const specErrors = validateFlowSpec(spec);
      if (specErrors.length > 0) {
        lastErrors = specErrors.map((e) => `spec.${e.path}: ${e.message}`);
      } else {
        const source = renderFlowDefinition(spec);
        bestSource = source;

        const loadErrors = await tryLoad(source);
        if (loadErrors.length > 0) {
          lastErrors = loadErrors;
        } else {
          const check = checkDefinitionSources([
            { path: "generated.ts", source },
          ]);
          const typeIssues = typecheckDefinitionSource(source, "__generate__");
          lastWarnings = check.warnings;
          const errors = [
            ...check.errors,
            ...typeIssues.map(
              (i) => `typecheck ${i.line}:${i.column} — ${i.message}`
            ),
          ];
          if (errors.length === 0) {
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
          lastErrors = errors;
        }
      }
    }

    const feedback = buildFeedback(lastErrors);
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

function buildFeedback(errors: string[]): string {
  return [
    "Your previous spec was rejected. Fix every issue below and return a corrected JSON flow spec (same format, one fenced block). Do not argue; do not repeat the same mistakes.",
    "",
    ...errors.map((e) => `- ${e}`),
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
