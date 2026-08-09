/** The flow-authoring session: a hidden built-in flow whose single workflow
 * instance is a live authoring conversation — the requirements-drafting
 * pattern (queen-bee) applied to flow authoring, where the artifact is a
 * FlowSpec/TypeScript definition instead of requirements.md.
 *
 * The session has ONE state: drafting. The ai-chat agent maintains the spec
 * draft via `set_flow_spec` (rendered live as TypeScript in the editor), and
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
import { loadDefinitionFromSource } from "../flow-definitions";
import { analyzeFlowSpec, type FlowSpec, validateFlowSpec } from "../flow-spec";
import { renderFlowDefinition } from "../render-flow-definition";
import { checkDefinitionSources } from "../schema-consistency";
import { typecheckDefinitionSource } from "../typecheck-definition";
import { renderPatternsPrompt } from "./patterns";
import { AUTHORING_RULES } from "./rules";
import { buildAuthoringSessionPrompt } from "./session-prompt";
import { FLOW_SPEC_SHAPE } from "./vocabulary";

export const AUTHORING_DEFINITION_ID = "flow-authoring";

export type AuthoringItemState = {
  // The user's original request (the session card's title).
  prompt?: string;
  // How this session was started: conversational asks clarifying questions and
  // drafts interactively; lucky produces the spec without questions.
  mode?: "conversational" | "lucky";
  // The current FlowSpec draft, maintained by the agent via set_flow_spec.
  spec?: string;
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
  // The spec's label — a suggested name for the saved definition.
  suggestedName?: string;
};

// ─── shared gate machinery ────────────────────────────────────────────

// Validates + renders a spec for the live preview; returns the parsed spec and
// any findings. Used by both tools so the draft and the generated source never
// drift.
type SpecPreview = {
  parsed: FlowSpec;
  previewSource: string;
  previewErrors: string[];
};

function validateAndPreview(specJson: string): SpecPreview {
  const parsed = JSON.parse(specJson) as FlowSpec;
  const findings = [
    ...validateFlowSpec(parsed),
    ...analyzeFlowSpec(parsed).map((finding) => ({
      path: "flow",
      message: finding,
    })),
  ];
  if (findings.length > 0) {
    return {
      parsed,
      previewSource: "",
      previewErrors: findings.map((e) => `spec.${e.path}: ${e.message}`),
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

// The full generation gate: spec validation → render → load → schema check →
// typecheck. Returns the source (empty on failure) and the findings.
async function runGenerationGate(
  spec: FlowSpec
): Promise<{ source: string; errors: string[]; warnings: string[] }> {
  const specWarnings = analyzeFlowSpec(spec);

  const source = renderFlowDefinition(spec);

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
    return { source, errors: loadErrors, warnings: specWarnings };
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
    warnings: [...specWarnings, ...check.warnings],
  };
}

// The knowledge reference the session agent consults on demand (progressive
// disclosure): each topic returns the relevant module so the system prompt can
// stay compact and the agent reads only what it needs when drafting.
const KNOWLEDGE_TOPICS: Record<string, string> = {
  vocabulary: FLOW_SPEC_SHAPE,
  patterns: renderPatternsPrompt(),
  capabilities: authoringGuide(),
  rules: AUTHORING_RULES,
};

// ─── tools ────────────────────────────────────────────────────────────

export const authoringTools = [
  defineTool<AuthoringItemState>({
    name: "read_authoring_knowledge",
    description:
      "Read a section of the flow-authoring reference before writing or extending a spec. Topics: 'vocabulary' (the FlowSpec JSON shape and constraints), 'patterns' (tested lifecycle exemplars), 'capabilities' (engine operations, infrastructure tools, state fields), or 'rules' (failure-mode guardrails).",
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

      let preview: SpecPreview;
      try {
        preview = validateAndPreview(args.spec);
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `spec is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }

      ctx.patchWorkflowInstanceState?.({
        spec: args.spec,
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
      "Run the generation gate on the current spec draft and produce the TypeScript definition in the editor. Pass the same spec JSON you last passed to set_flow_spec. Returns the gate findings — if there are errors, fix the spec with set_flow_spec and call this again. The conversation continues after a successful generation.",
    parameters: {
      properties: {
        spec: {
          type: "string",
          description: "The complete FlowSpec JSON to generate.",
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

      let preview: SpecPreview;
      try {
        preview = validateAndPreview(args.spec);
      } catch (err) {
        return {
          toolCallId: call.id,
          content: `spec is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }

      if (preview.previewErrors.length > 0) {
        ctx.patchWorkflowInstanceState?.({
          spec: args.spec,
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
          spec: args.spec,
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
        spec: args.spec,
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
];

// ─── the workflow ─────────────────────────────────────────────────────

const sessionWorkflow = defineWorkflow({
  id: "session",
  label: "Authoring session",
  instance: { title: "prompt" },
  // There is only ever one session instance — a board with 300px columns
  // would cramp the chat and preview. A flat list renders one full-width
  // card carrying its state.
  ui: { view: "list" },
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
          // The session stays interactive for its whole life — the agent can
          // generate, fail the gate, fix, and regenerate while the user keeps
          // chatting; it ends only when the user closes it or leaves.
          startOnUserInput: true,
          systemPrompt: buildAuthoringSessionPrompt(),
          tools: [
            "read_authoring_knowledge",
            "set_flow_spec",
            "generate_definition",
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
    "A live conversation that designs a Hive flow definition, maintaining the spec draft as decisions are made.",
  configSchema: [],
  workflows: [sessionWorkflow],
  tools: authoringTools,
  actions: [],
  edges: [],
} satisfies FlowDefinition;
