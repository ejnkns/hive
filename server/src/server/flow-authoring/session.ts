/** The flow-authoring session: a hidden built-in flow whose single workflow
 * instance is a live authoring conversation — the requirements-drafting
 * pattern (queen-bee) applied to flow authoring, where the artifact is a
 * FlowBlueprint/TypeScript definition instead of requirements.md.
 *
 * The session has ONE state: drafting. The ai-chat agent maintains the blueprint
 * draft via `set_flow_blueprint` (rendered live as TypeScript in the editor), and
 * the generation gate runs as the `generate_definition` TOOL — so a failed
 * gate returns its findings to the agent in the same conversation (nothing is
 * lost), the agent fixes and retries, and the session never ends on its own:
 * it stays alive until the user closes it or leaves the page. */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { defineTool } from "workflow-engine/runners";
import {
  defineWorkflow,
  type FlowDefinition,
} from "workflow-engine/workflow-types";
import {
  analyzeFlowBlueprint,
  type FlowBlueprint,
  validateFlowBlueprint,
} from "../flow-blueprint.ts";
import {
  loadDefinitionFromSource,
  registerUserDefinition,
  updateUserDefinition,
} from "../flow-definitions.ts";
import { renderFlowDefinition } from "../render-flow-definition.ts";
import { checkDefinitionSources } from "../schema-consistency.ts";
import { typecheckDefinitionSource } from "../typecheck-definition.ts";
import { renderPatternsPrompt } from "./patterns.ts";
import { AUTHORING_RULES } from "./rules.ts";
import { buildAuthoringSessionPrompt } from "./session-prompt.ts";
import { FLOW_BLUEPRINT_SHAPE } from "./vocabulary.ts";

export const AUTHORING_DEFINITION_ID = "flow-authoring";

export type AuthoringItemState = {
  // The user's original request (the session card's title).
  prompt?: string;
  // How this session was started: conversational asks clarifying questions and
  // drafts interactively; lucky produces the blueprint without questions.
  mode?: "conversational" | "lucky";
  // The current FlowBlueprint draft, maintained by the agent via set_flow_blueprint.
  blueprint?: string;
  // The rendered TypeScript of the current draft (live preview in the editor).
  previewSource?: string;
  // Validation/render findings of the current draft (fed back to the agent).
  previewErrors?: string[];
  // The gate findings of the last generate_definition call.
  gateErrors?: string[];
  // The gate outcome of the last generate_definition call.
  report?: {
    passed: boolean;
    attempts: number;
    errors: string[];
    warnings: string[];
  };
  // The gate-passed TypeScript source (written by generate_definition).
  source?: string;
  // The blueprint's label — a suggested name for the saved definition.
  suggestedName?: string;
  // The registered definition id after a successful save. Written by the
  // save_definition tool (agent path) and the synchronous save route (the
  // editor's Save button) — both run the same saveAuthoringDefinition core.
  savedDefinitionId?: string;
  // The resolved display name of the saved definition (the suggested name or
  // the agent's explicit override).
  savedName?: string;
  // Non-blocking schema-consistency findings from the last save.
  saveFindings?: { errors: string[]; warnings: string[] };
  // True while the human has edited the definition TS directly (the editor's
  // write-back). The blueprint draft is frozen: set_flow_blueprint/generate_definition
  // refuse until the human discards (or adopts, via the future reverse
  // renderer) their edits.
  blueprintDiverged?: boolean;
};

// ─── shared gate machinery ────────────────────────────────────────────

// Validates + renders a blueprint for the live preview; returns the parsed blueprint and
// any findings. Used by both tools so the draft and the generated source never
// drift.
type BlueprintPreview = {
  parsed: FlowBlueprint;
  previewSource: string;
  previewErrors: string[];
};

function validateAndPreview(blueprintJson: string): BlueprintPreview {
  const parsed = JSON.parse(blueprintJson) as FlowBlueprint;
  const findings = [
    ...validateFlowBlueprint(parsed),
    ...analyzeFlowBlueprint(parsed).map((finding) => ({
      path: "flow",
      message: finding,
    })),
  ];
  if (findings.length > 0) {
    return {
      parsed,
      previewSource: "",
      previewErrors: findings.map((e) => `blueprint.${e.path}: ${e.message}`),
    };
  }
  try {
    return {
      parsed,
      previewSource: renderFlowDefinition(parsed),
      previewErrors: [],
    };
  } catch (err) {
    return {
      parsed,
      previewSource: "",
      previewErrors: [
        `render failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

// The full generation gate: blueprint validation → render → load → schema check →
// typecheck. Returns the source (empty on failure) and the findings.
async function runGenerationGate(
  blueprint: FlowBlueprint
): Promise<{ source: string; errors: string[]; warnings: string[] }> {
  const blueprintWarnings = analyzeFlowBlueprint(blueprint);

  const source = renderFlowDefinition(blueprint);

  let loadErrors: string[] = [];
  try {
    await loadDefinitionFromSource("__authoring__", source);
  } catch (err) {
    loadErrors = [
      `The generated definition failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`,
    ];
  }
  if (loadErrors.length > 0) {
    return { source, errors: loadErrors, warnings: blueprintWarnings };
  }

  const check = checkDefinitionSources([{ path: "authoring.ts", source }]);
  const typeIssues = typecheckDefinitionSource(source, "__authoring__");
  const errors = [
    ...check.errors,
    ...typeIssues.map((i) => `typecheck ${i.line}:${i.column} — ${i.message}`),
  ];
  return {
    source,
    errors,
    warnings: [...blueprintWarnings, ...check.warnings],
  };
}

// The knowledge reference the session agent consults on demand (progressive
// disclosure): each topic returns the relevant module so the system prompt can
// stay compact and the agent reads only what it needs when drafting.
const KNOWLEDGE_TOPICS: Record<string, string> = {
  vocabulary: FLOW_BLUEPRINT_SHAPE,
  patterns: renderPatternsPrompt(),
  capabilities: authoringGuide(),
  rules: AUTHORING_RULES,
};

// ─── save ────────────────────────────────────────────────────────────────

// The one save implementation, shared by the save_definition tool (the agent
// saves from chat) and the synchronous save route (the editor's Save button):
// register the session's generated source as a definition — create on the
// first save, update by savedDefinitionId afterwards. Returns the id, the
// resolved name, and the non-blocking schema-consistency findings (the
// definition loads and runs regardless; findings annotate it for the author).
export async function saveAuthoringDefinition(
  state: AuthoringItemState,
  nameOverride?: string
): Promise<{
  id: string;
  name: string;
  checkErrors: string[];
  checkWarnings: string[];
}> {
  const source = typeof state.source === "string" ? state.source : "";
  if (source === "") {
    throw new Error(
      "Nothing to save — ask the agent to generate a definition first."
    );
  }
  const suggested =
    typeof state.suggestedName === "string" ? state.suggestedName : "";
  const name =
    nameOverride !== undefined && nameOverride.trim() !== ""
      ? nameOverride.trim()
      : suggested;
  if (name === "") {
    throw new Error("Definition name is required");
  }

  const targetId = state.savedDefinitionId;
  const record = targetId
    ? await updateUserDefinition(targetId, { name, source })
    : await registerUserDefinition({ name, source });
  const check = checkDefinitionSources([{ path: `${record.id}.ts`, source }]);
  return {
    id: record.id,
    name: record.name,
    checkErrors: check.errors,
    checkWarnings: check.warnings,
  };
}

// The instance-state patch both save paths apply on success, so the editor
// reflects the saved definition from the snapshot.
export function savePatch(result: {
  id: string;
  name: string;
  checkErrors: string[];
  checkWarnings: string[];
}): Pick<
  AuthoringItemState,
  "savedDefinitionId" | "savedName" | "saveFindings"
> {
  return {
    savedDefinitionId: result.id,
    savedName: result.name,
    saveFindings: {
      errors: result.checkErrors,
      warnings: result.checkWarnings,
    },
  };
}

// The divergence gate both blueprint tools enforce: while the human owns the
// source (blueprintDiverged, set by the editor's write-back), the agent must not
// overwrite it — it proposes in chat instead.
function divergedResult(call: { id: string }): {
  toolCallId: string;
  content: string;
  isError: boolean;
} {
  return {
    toolCallId: call.id,
    content:
      "The definition has manual edits (the user edited the TypeScript directly), so the blueprint is frozen. Do not overwrite it. Propose changes in chat — read the current source with read_definition_source — and let the user apply them, discard their edits, or adopt them.",
    isError: true,
  };
}

function isDiverged(ctx: {
  workflowInstanceState?: () => AuthoringItemState;
}): boolean {
  return ctx.workflowInstanceState?.()?.blueprintDiverged === true;
}

// ─── tools ────────────────────────────────────────────────────────────

export const authoringTools = [
  defineTool<AuthoringItemState>({
    name: "read_authoring_knowledge",
    description:
      "Read a section of the flow-authoring reference before writing or extending a blueprint. Topics: 'vocabulary' (the FlowBlueprint JSON shape and constraints), 'patterns' (tested lifecycle exemplars), 'capabilities' (engine operations, infrastructure tools, state fields), or 'rules' (failure-mode guardrails).",
    parameters: {
      properties: {
        topic: {
          type: "string",
          enum: ["vocabulary", "patterns", "capabilities", "rules"],
        },
      },
      required: ["topic"],
    },
    executor: async (call) => {
      const args = JSON.parse(call.arguments) as { topic?: string };
      const content = args.topic ? KNOWLEDGE_TOPICS[args.topic] : undefined;
      return content === undefined
        ? {
            toolCallId: call.id,
            content: `Unknown topic "${args.topic}". Topics: ${Object.keys(KNOWLEDGE_TOPICS).join(", ")}`,
            isError: true,
          }
        : { toolCallId: call.id, content, isError: false };
    },
  }),
  defineTool<AuthoringItemState>({
    name: "set_flow_blueprint",
    description:
      "Replace the flow's blueprint draft with the complete FlowBlueprint JSON. Call this after every substantive decision with the full blueprint; the draft renders live in the editor. The result reports validation errors to fix.",
    parameters: {
      properties: {
        blueprint: {
          type: "string",
          description: "The complete FlowBlueprint as a JSON string.",
        },
      },
      required: ["blueprint"],
    },
    executor: async (call, ctx) => {
      if (isDiverged(ctx)) return divergedResult(call);
      const args = JSON.parse(call.arguments) as { blueprint?: string };
      if (typeof args.blueprint !== "string" || args.blueprint.trim() === "") {
        return {
          toolCallId: call.id,
          content: "blueprint is required",
          isError: true,
        };
      }

      let preview: BlueprintPreview;
      try {
        preview = validateAndPreview(args.blueprint);
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `blueprint is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }

      ctx.patchWorkflowInstanceState?.({
        blueprint: args.blueprint,
        previewSource: preview.previewSource,
        previewErrors: preview.previewErrors,
      });

      return {
        toolCallId: call.id,
        content:
          preview.previewErrors.length > 0
            ? `Spec draft stored, but it has ${preview.previewErrors.length} finding(s):\n${preview.previewErrors
                .slice(0, 10)
                .join("\n")}`
            : "Spec draft stored and renders cleanly.",
        isError: false,
      };
    },
  }),
  defineTool<AuthoringItemState>({
    name: "generate_definition",
    description:
      "Run the generation gate on the current blueprint draft and produce the TypeScript definition in the editor. Pass the same blueprint JSON you last passed to set_flow_blueprint. Returns the gate findings — if there are errors, fix the blueprint with set_flow_blueprint and call this again. The conversation continues after a successful generation.",
    parameters: {
      properties: {
        blueprint: {
          type: "string",
          description: "The complete FlowBlueprint JSON to generate.",
        },
      },
      required: ["blueprint"],
    },
    executor: async (call, ctx) => {
      if (isDiverged(ctx)) return divergedResult(call);
      const args = JSON.parse(call.arguments) as { blueprint?: string };
      if (typeof args.blueprint !== "string" || args.blueprint.trim() === "") {
        return {
          toolCallId: call.id,
          content: "blueprint is required",
          isError: true,
        };
      }

      let preview: BlueprintPreview;
      try {
        preview = validateAndPreview(args.blueprint);
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `blueprint is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }

      if (preview.previewErrors.length > 0) {
        ctx.patchWorkflowInstanceState?.({
          blueprint: args.blueprint,
          previewSource: preview.previewSource,
          previewErrors: preview.previewErrors,
          gateErrors: preview.previewErrors,
          report: {
            passed: false,
            attempts: 1,
            errors: preview.previewErrors,
            warnings: [],
          },
        });
        return {
          toolCallId: call.id,
          content: `The definition failed validation. Fix these findings, then call generate_definition again:\n${preview.previewErrors
            .slice(0, 12)
            .map((e) => `- ${e}`)
            .join("\n")}`,
          isError: false,
        };
      }

      const { source, errors, warnings } = await runGenerationGate(
        preview.parsed
      );
      if (errors.length > 0) {
        ctx.patchWorkflowInstanceState?.({
          blueprint: args.blueprint,
          previewSource: preview.previewSource,
          previewErrors: [],
          gateErrors: errors,
          report: { passed: false, attempts: 1, errors, warnings },
          suggestedName: preview.parsed.label,
        });
        return {
          toolCallId: call.id,
          content: `The definition failed the gate. Fix these findings, then call generate_definition again:\n${errors
            .slice(0, 12)
            .map((e) => `- ${e}`)
            .join("\n")}`,
          isError: false,
        };
      }

      ctx.patchWorkflowInstanceState?.({
        blueprint: args.blueprint,
        previewSource: source,
        previewErrors: [],
        source,
        gateErrors: [],
        report: { passed: true, attempts: 1, errors: [], warnings },
        suggestedName: preview.parsed.label,
      });
      return {
        toolCallId: call.id,
        content:
          "Definition generated successfully — the TypeScript source is now in the editor. Summarize the definition for the user.",
        isError: false,
      };
    },
  }),
  defineTool<AuthoringItemState>({
    name: "save_definition",
    description:
      "Register the current generated definition (the source in the editor) as a flow definition. Call this when the user asks to save or says it is ready — the definition registers immediately and the editor shows the saved state. The first save creates the definition (named from the blueprint's label, or the explicit name); later saves update the same definition.",
    parameters: {
      properties: {
        name: {
          type: "string",
          description:
            "Optional name override. Defaults to the blueprint's label (suggestedName).",
        },
      },
      required: [],
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as { name?: string };
      try {
        const result = await saveAuthoringDefinition(
          ctx.workflowInstanceState?.() ?? {},
          typeof args.name === "string" ? args.name : undefined
        );
        ctx.patchWorkflowInstanceState?.(savePatch(result));
        const findings =
          result.checkErrors.length > 0 || result.checkWarnings.length > 0
            ? `\nFindings: ${result.checkErrors.length} error(s), ${result.checkWarnings.length} warning(s).`
            : "";
        return {
          toolCallId: call.id,
          content: `Definition saved as "${result.name}" (${result.id}).${findings}`,
          isError: false,
        };
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  }),
  defineTool<AuthoringItemState>({
    name: "read_definition_source",
    description:
      "Read the current definition TypeScript — the working artifact, including any manual edits the user made directly in the editor. Use this to reason about the exact current source before proposing changes (especially while the blueprint is frozen by manual edits).",
    parameters: {
      properties: {},
      required: [],
    },
    executor: async (call, ctx) => {
      const source = ctx.workflowInstanceState?.()?.source;
      return {
        toolCallId: call.id,
        content:
          typeof source === "string" && source !== ""
            ? source
            : "No definition source yet — the agent's last generate_definition output, or a manual edit, will appear here.",
        isError: false,
      };
    },
  }),
];

// ─── the workflow ─────────────────────────────────────────────────────

const sessionWorkflow = defineWorkflow({
  id: "session",
  label: "Authoring session",
  instance: { title: "prompt" },
  // There is only ever one session instance — a board with 300px columns
  // would cramp the chat and preview. A flat list renders one full-width
  // card carrying its state; the instance component (flow-editor) renders
  // the session as the editor: header, chat, tokenized preview, actions.
  ui: { view: "list", instanceComponent: "flow-editor" },
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
      // Saving is a flow capability: the agent calls the save_definition tool
      // on request, and the editor's Save button reaches the same core
      // synchronously through a thin route. No ManualActions — the session
      // has no transitions.
      tasks: [
        {
          id: "assistant",
          label: "Authoring assistant",
          role: "ai-chat",
          trigger: "auto",
          // The session stays interactive for its whole life — the agent can
          // generate, fail the gate, fix, and regenerate while the user keeps
          // chatting; it ends only when the user closes it or leaves.
          startOnUserInput: true,
          systemPrompt: buildAuthoringSessionPrompt(),
          tools: [
            "read_authoring_knowledge",
            "set_flow_blueprint",
            "generate_definition",
            "save_definition",
            "read_definition_source",
          ],
        },
      ],
    },
  ],
  initial: "drafting",
  terminalStates: [],
});

export const authoringSessionFlow = {
  id: AUTHORING_DEFINITION_ID,
  label: "Flow Authoring Session",
  description:
    "A live conversation that designs a Hive flow definition, maintaining the blueprint draft as decisions are made.",
  configSchema: [],
  workflows: [sessionWorkflow],
  tools: authoringTools,
  actions: [],
  edges: [],
} satisfies FlowDefinition;
