/** The flow-authoring session: a hidden built-in flow whose single workflow
 * instance is a live, interactive authoring conversation. The user and an
 * ai-chat agent (the flow-authoring knowledge + conversational mode) converge
 * on a FlowSpec; the agent maintains the draft via `set_flow_spec` (patched
 * into instance state, rendered live as TypeScript in the editor); Finalize —
 * a button or the agent's `finish_authoring` completion — runs the full
 * generation gate; failures bounce back to a revising round (bounded) with
 * the errors seeded to the agent.
 *
 * This is the requirements-drafting pattern (queen-bee) applied to flow
 * authoring: a session is a workflow instance, so persistence, the realtime
 * snapshot channel, and the chat UI come from the engine for free.
 *
 * The definition lives server-side and its tools/operations import the
 * server's own generation machinery (flow-spec, renderer, the gate) — it is
 * the one flow that authors other flows. */

import {
  defineOperations,
  defineTool,
  type OperationContext,
  type OperationFn,
} from "workflow-engine/runners";
import {
  defineWorkflow,
  type FlowDefinition,
} from "workflow-engine/workflow-types";
import { loadDefinitionFromSource } from "../flow-definitions";
import { analyzeFlowSpec, type FlowSpec, validateFlowSpec } from "../flow-spec";
import { renderFlowDefinition } from "../render-flow-definition";
import { checkDefinitionSources } from "../schema-consistency";
import { typecheckDefinitionSource } from "../typecheck-definition";
import { buildAuthoringSessionPrompt } from "./session-prompt";

export const AUTHORING_DEFINITION_ID = "flow-authoring";

export type AuthoringItemState = {
  // The user's original request (the session card's title).
  prompt?: string;
  // The current FlowSpec draft, maintained by the agent via set_flow_spec.
  spec?: string;
  // The rendered TypeScript of the current draft (live preview in the editor).
  previewSource?: string;
  // Validation/render findings of the current draft (fed back to the agent).
  previewErrors?: string[];
  // The seed message for a revising round: gate errors + the current spec.
  revisionInput?: string;
  // The gate findings of the last finalize attempt.
  gateErrors?: string[];
  // The gate outcome of the last finalize attempt.
  report?: {
    passed: boolean;
    attempts: number;
    errors: string[];
    warnings: string[];
  };
  // The final gate-passed TypeScript source (written by finalize_spec).
  source?: string;
  // The spec's label — a suggested name for the saved definition, so a new
  // definition can be saved without the user typing a name.
  suggestedName?: string;
};

// ─── tools ────────────────────────────────────────────────────────────

export const authoringTools = [
  defineTool<AuthoringItemState>({
    name: "set_flow_spec",
    description:
      "Replace the flow's spec draft with the complete FlowSpec JSON. Call this after every substantive decision with the full spec; the draft renders live in the editor. The result reports validation errors to fix.",
    parameters: {
      properties: {
        spec: {
          type: "string",
          description: "The complete FlowSpec as a JSON string.",
        },
      },
      required: ["spec"],
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as { spec?: string };
      if (typeof args.spec !== "string" || args.spec.trim() === "") {
        return {
          toolCallId: call.id,
          content: "spec is required",
          isError: true,
        };
      }

      let parsed: FlowSpec;
      try {
        parsed = JSON.parse(args.spec) as FlowSpec;
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `spec is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }

      const findings = [
        ...validateFlowSpec(parsed),
        ...analyzeFlowSpec(parsed).map((finding) => ({
          path: "flow",
          message: finding,
        })),
      ];
      let previewSource = "";
      let previewErrors: string[] = findings.map(
        (e) => `spec.${e.path}: ${e.message}`
      );
      if (findings.length === 0) {
        try {
          previewSource = renderFlowDefinition(parsed);
        } catch (err) {
          previewErrors = [
            `render failed: ${err instanceof Error ? err.message : String(err)}`,
          ];
        }
      }

      ctx.patchWorkflowInstanceState?.({
        spec: args.spec,
        previewSource,
        previewErrors,
      });

      return {
        toolCallId: call.id,
        content:
          previewErrors.length > 0
            ? `Spec draft stored, but it has ${previewErrors.length} finding(s):\n${previewErrors
                .slice(0, 10)
                .join("\n")}`
            : "Spec draft stored and renders cleanly.",
        isError: false,
      };
    },
  }),
  defineTool<AuthoringItemState>({
    name: "finish_authoring",
    description:
      "Finish the authoring session and generate the flow definition from the current spec draft. Call this only when the user asks to generate, or the spec is complete and the user has confirmed it.",
    parameters: { properties: {}, required: [] },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Finalizing",
      isError: false,
    }),
  }),
];

// ─── operations ───────────────────────────────────────────────────────

// Composes a gate failure: records the findings + current spec into instance
// state (the revising round's seed) and returns the Error to throw, so the
// op's taskError gates route the session to a bounded revising round.
function gateFailure(
  ctx: OperationContext<AuthoringItemState>,
  errors: string[],
  warnings: string[],
  specJson?: string
): Error {
  const revisionInput = [
    "The flow spec failed the gate. Fix every issue below, call set_flow_spec with the corrected complete spec, then call finish_authoring.",
    "",
    "Gate findings:",
    ...errors.map((e) => `- ${e}`),
    ...(warnings.length > 0
      ? [
          "",
          "Advisory findings to fix along the way:",
          ...warnings.map((w) => `- ${w}`),
        ]
      : []),
    "",
    `Current spec:\n${specJson ?? "(no spec draft written)"}`,
  ].join("\n");
  ctx.patchWorkflowInstanceState({
    revisionInput,
    gateErrors: errors,
    report: { passed: false, attempts: 1, errors, warnings },
  });
  return new Error(errors[0] ?? "Spec failed the gate");
}

// The full generation gate: spec validation → render → load → schema check →
// typecheck. On success the final source is patched into instance state; on
// failure the errors (plus the current spec) are composed into revisionInput
// for a bounded revising round, and the op throws so taskError gates route it.
const finalizeSpec: OperationFn<AuthoringItemState> = async (
  _task,
  _params,
  ctx
): Promise<{ ok: boolean }> => {
  const state = ctx.workflowInstanceState();
  const specJson = state.spec;

  if (specJson === undefined || specJson.trim() === "") {
    throw gateFailure(
      ctx,
      [
        "No spec draft has been written — the agent must call set_flow_spec first.",
      ],
      []
    );
  }

  let spec: FlowSpec;
  try {
    spec = JSON.parse(specJson) as FlowSpec;
  } catch (err) {
    throw gateFailure(
      ctx,
      [
        `The spec draft is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
      [],
      specJson
    );
  }

  const specErrors = validateFlowSpec(spec);
  const specWarnings = analyzeFlowSpec(spec);
  if (specErrors.length > 0) {
    throw gateFailure(
      ctx,
      specErrors.map((e) => `spec.${e.path}: ${e.message}`),
      specWarnings,
      specJson
    );
  }

  const source = renderFlowDefinition(spec);

  let loadErrors: string[] = [];
  try {
    await loadDefinitionFromSource("__authoring__", source);
  } catch (err) {
    loadErrors = [
      `The generated definition failed to load: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }
  if (loadErrors.length > 0) {
    throw gateFailure(ctx, loadErrors, specWarnings, specJson);
  }

  const check = checkDefinitionSources([{ path: "authoring.ts", source }]);
  const typeIssues = typecheckDefinitionSource(source, "__authoring__");
  const errors = [
    ...check.errors,
    ...typeIssues.map((i) => `typecheck ${i.line}:${i.column} — ${i.message}`),
  ];
  if (errors.length > 0) {
    throw gateFailure(
      ctx,
      errors,
      [...specWarnings, ...check.warnings],
      specJson
    );
  }

  ctx.patchWorkflowInstanceState({
    source,
    gateErrors: [],
    revisionInput: undefined,
    suggestedName: spec.label,
    report: {
      passed: true,
      attempts: 1,
      errors: [],
      warnings: [...specWarnings, ...check.warnings],
    },
  });
  return { ok: true };
};

export const authoringOperations = defineOperations<AuthoringItemState>({
  finalize_spec: finalizeSpec,
});

// ─── the workflow ─────────────────────────────────────────────────────

const sessionWorkflow = defineWorkflow({
  id: "session",
  label: "Authoring session",
  instance: { title: "prompt" },
  display: {
    fields: [{ path: "prompt", label: "Request" }],
  },
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as AuthoringItemState,
  states: [
    {
      id: "drafting",
      label: "Drafting",
      category: "initial",
      tasks: [
        {
          id: "assistant",
          label: "Authoring assistant",
          role: "ai-chat",
          trigger: "auto",
          startOnUserInput: true,
          systemPrompt: buildAuthoringSessionPrompt(),
          tools: ["set_flow_spec", "finish_authoring"],
          completionTool: "finish_authoring",
        },
      ],
      actions: [
        {
          id: "finalize",
          label: "Finalize and generate",
          variant: "primary",
          completesRunningTask: true,
          transitionTo: "finalizing",
        },
      ],
      autoTransitions: [
        {
          // The agent called finish_authoring — the session completed.
          to: "finalizing",
          gate: (ctx) => ctx.taskOutputs.assistant?.status === "success",
        },
      ],
    },
    {
      id: "finalizing",
      label: "Finalizing",
      category: "active",
      tasks: [
        {
          id: "runFinalize",
          label: "Run the generation gate",
          role: "operation",
          trigger: "auto",
          operations: ["finalize_spec"],
        },
      ],
      autoTransitions: [
        {
          // Bounded retries: after three failed finalize runs the session
          // gives up instead of bouncing between drafting and revising forever.
          to: "failed",
          gate: (ctx) => (ctx.taskErrorCounts.runFinalize ?? 0) >= 3,
        },
        {
          to: "revising",
          gate: (ctx) => ctx.taskOutputs.runFinalize?.status === "error",
        },
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.runFinalize?.status === "success",
        },
      ],
    },
    {
      id: "revising",
      label: "Revising",
      category: "active",
      tasks: [
        {
          id: "revise",
          label: "Revise from gate findings",
          role: "ai-chat",
          trigger: "auto",
          // Auto-driven (not interactive): the seeded revisionInput carries
          // the errors and the current spec; the agent fixes, then completes.
          startOnUserInput: false,
          systemPrompt: buildAuthoringSessionPrompt(),
          inputFromInstanceState: "revisionInput",
          tools: ["set_flow_spec", "finish_authoring"],
          completionTool: "finish_authoring",
        },
      ],
      autoTransitions: [
        {
          to: "finalizing",
          gate: (ctx) => ctx.taskOutputs.revise?.status === "success",
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
    { id: "failed", label: "Failed", category: "terminal" },
  ],
  initial: "drafting",
  terminalStates: ["done", "failed"],
});

export const authoringSessionFlow = {
  id: AUTHORING_DEFINITION_ID,
  label: "Flow Authoring Session",
  description:
    "A live conversation that designs a Hive flow definition, maintaining the spec draft as decisions are made.",
  configSchema: [],
  workflows: [sessionWorkflow],
  operations: { ...authoringOperations },
  tools: authoringTools,
  actions: [],
  edges: [],
} satisfies FlowDefinition;
