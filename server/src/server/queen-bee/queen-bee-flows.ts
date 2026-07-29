import type {
  AutoTransition,
  FlowDefinition,
  FlowEdge,
  GateContext,
  StateDef,
} from "workflow-engine/workflow-types";
import { defineWorkflow, type NoOutput } from "workflow-engine/workflow-types";

// === QUEEN BEE FLOW ===
//
// The queen-bee project lifecycle expressed as three interacting workflows
// wired together by a FlowDefinition.
//
// Requirements: one item (the requirements doc). Session + planner agent.
//    no_session → drafting (session) → complete → planning (agent) → planned → accepted
//
// Ideas: per-idea items. Session task, feeds into planning.
//    backlog → elaborating (session) → refined → submitted → archived
//
// Cards: per-card items. Worker agent, reviewer, coordinator.
//    ready → in_progress → reviewing → done | unfulfillable
//
// Flow edges:
//    ideas/submitted → requirements (merge draft, trigger planning)
//    requirements/accepted → cards (create cards in ready)

export const queenBeeFlow = {
  id: "queen-bee",
  label: "Queen Bee",
  workflows: [
    defineWorkflow({
      id: "requirements",
      label: "Requirements",
      taskOutputs: {
        draft: {} as { content: string; revision: string },
        plan: {} as { kind: "proposal" | "feedback"; cards?: unknown[] },
      },
      states: [
        {
          id: "no_session",
          label: "No Session",
          actions: [
            {
              id: "start",
              label: "Start requirements session",
              gate: (ctx) => !ctx.hasRunningTask,
              effect: () => ({ transitionTo: "drafting" }),
            },
          ],
        },
        {
          id: "drafting",
          label: "Drafting",
          description:
            "Multi-turn requirements session. User and Requirements Agent " +
            "converse until the agent signals completion.",
          tasks: [
            {
              id: "draft",
              label: "Requirements session",
              trigger: "manual",
              role: "ai-chat",
              tools: ["read_file", "search_code"],
              systemPrompt:
                "You are a requirements analyst. Ask the user questions " +
                "to understand their needs, produce a structured requirements " +
                "document. Signal REQUIREMENTS_COMPLETE when done.",
            },
          ],
          autoTransitions: [
            {
              to: "complete",
              gate: (ctx) => ctx.taskOutputs.draft?.status === "success",
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel session",
              gate: (ctx) => ctx.hasRunningTask,
              effect: () => ({ transitionTo: "no_session" }),
            },
            {
              id: "reset",
              label: "Reset",
              effect: () => ({ transitionTo: "no_session" }),
            },
          ],
        },
        {
          id: "complete",
          label: "Complete",
          description:
            "Requirements draft ready. User approves to submit " +
            "for planning, or resets.",
          actions: [
            {
              id: "approve",
              label: "Submit for planning",
              effect: () => ({ transitionTo: "planning" }),
            },
            {
              id: "reset",
              label: "Reset",
              effect: () => ({ transitionTo: "no_session" }),
            },
          ],
        },
        {
          id: "planning",
          label: "Planning",
          description:
            "Planner Agent processes the requirements draft. " +
            "Returns either RequirementsFeedback (→ repair) " +
            "or PlanningProposal (→ review).",
          tasks: [
            {
              id: "plan",
              label: "Run planner",
              trigger: "auto",
              role: "ai-task",
              tools: ["read_file", "search_code"],
              systemPrompt:
                "You are a technical planner. Decompose requirements " +
                "into cards with acceptance criteria.",
            },
          ],
          actions: [
            {
              id: "accept_proposal",
              label: "Accept proposal",
              gate: (ctx) => ctx.taskOutputs.plan?.output.kind === "proposal",
              effect: () => ({ transitionTo: "planned" }),
            },
            {
              id: "repair",
              label: "Start repair session",
              gate: (ctx) => ctx.taskOutputs.plan?.output.kind === "feedback",
              effect: () => ({ transitionTo: "drafting" }),
            },
          ],
        },
        {
          id: "planned",
          label: "Planned",
          description:
            "Proposal ready. User accepts individual changes " +
            "or accepts all. Applied proposal creates cards.",
          actions: [
            {
              id: "accept_all",
              label: "Accept all and create cards",
              effect: () => ({ transitionTo: "accepted" }),
            },
            {
              id: "replan",
              label: "Request replanning",
              effect: () => ({ transitionTo: "complete" }),
            },
          ],
        },
        {
          id: "accepted",
          label: "Accepted",
          description: "Proposal applied. Cards created in Ready.",
        },
      ],
      initial: "no_session",
      terminalStates: ["accepted"],
    }),

    defineWorkflow({
      id: "ideas",
      label: "Ideas",
      taskOutputs: {
        elaborate: {} as { ideaBrief: string; elaboratedSpec: string },
      },
      states: [
        {
          id: "backlog",
          label: "Backlog",
          actions: [
            {
              id: "elaborate",
              label: "Elaborate idea",
              gate: (ctx) => !ctx.hasRunningTask,
              effect: () => ({ transitionTo: "elaborating" }),
            },
            {
              id: "archive",
              label: "Archive",
              effect: () => ({ transitionTo: "archived" }),
            },
          ],
        },
        {
          id: "elaborating",
          label: "Elaborating",
          description:
            "Multi-turn idea elaboration session. " +
            "Produces a requirements draft for this idea.",
          tasks: [
            {
              id: "elaborate",
              label: "Elaborate session",
              trigger: "manual",
              role: "ai-chat",
              tools: ["read_file", "search_code"],
              systemPrompt:
                "You are a product analyst. Ask the user questions " +
                "to clarify this idea. Produce a structured proposal.",
            },
          ],
          autoTransitions: [
            {
              to: "refined",
              gate: (ctx) => ctx.taskOutputs.elaborate?.status === "success",
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel",
              gate: (ctx) => ctx.hasRunningTask,
              effect: () => ({ transitionTo: "backlog" }),
            },
          ],
        },
        {
          id: "refined",
          label: "Refined",
          description:
            "Idea elaborated. User approves to trigger planning " +
            "with this idea's draft merged into requirements.",
          actions: [
            {
              id: "approve",
              label: "Submit for planning",
              effect: () => ({ transitionTo: "submitted" }),
            },
            {
              id: "reopen",
              label: "Reopen",
              effect: () => ({ transitionTo: "backlog" }),
            },
          ],
        },
        {
          id: "submitted",
          label: "Submitted",
          description:
            "Waiting for planning outcome. When the requirements " +
            "workflow reaches accepted, this idea gets archived.",
        },
        {
          id: "archived",
          label: "Archived",
        },
      ],
      initial: "backlog",
      terminalStates: ["submitted", "archived"],
    }),

    defineWorkflow({
      id: "cards",
      label: "Cards",
      taskOutputs: {
        implement: {} as NoOutput,
        review: {} as { verdict: "approved" | "changes_requested" },
        coordinate: {} as { summary: string },
      },
      states: [
        {
          id: "ready",
          label: "Ready",
          actions: [
            {
              id: "run",
              label: "Run Worker Agent",
              gate: (ctx) => !ctx.hasRunningTask,
              effect: () => ({ transitionTo: "in_progress" }),
            },
          ],
        },
        {
          id: "in_progress",
          label: "In Progress",
          tasks: [
            {
              id: "implement",
              label: "Implement",
              trigger: "auto",
              role: "ai-task",
              tools: ["read_file", "write_file", "run_command", "git_log"],
              systemPrompt: "You are a feature implementer...",
            },
          ],
          autoTransitions: [
            {
              to: "reviewing",
              gate: (ctx) => ctx.taskOutputs.implement?.status === "success",
            },
            {
              to: "ready",
              gate: (ctx) => ctx.taskOutputs.implement?.status === "error",
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel",
              gate: (ctx) => ctx.hasRunningTask,
              effect: () => ({ transitionTo: "ready" }),
            },
          ],
        },
        {
          id: "reviewing",
          label: "Reviewing",
          tasks: [
            {
              id: "review",
              label: "Review work",
              trigger: "auto",
              role: "ai-task",
              tools: ["read_file", "search_code", "git_log"],
              systemPrompt: "You are a code reviewer...",
            },
          ],
          actions: [
            {
              id: "accept",
              label: "Accept work",
              gate: (ctx) =>
                ctx.taskOutputs.review?.output?.verdict === "approved",
              effect: () => ({ transitionTo: "done" }),
            },
            {
              id: "accept_anyway",
              label: "Accept anyway",
              gate: (ctx) =>
                ctx.taskOutputs.review?.output?.verdict === "changes_requested",
              effect: () => ({ transitionTo: "done" }),
            },
            {
              id: "update_changes",
              label: "Update work",
              gate: (ctx) =>
                ctx.taskOutputs.review?.output?.verdict === "changes_requested",
              effect: () => ({ transitionTo: "in_progress" }),
            },
            {
              id: "new_changes",
              label: "New attempt",
              gate: (ctx) =>
                ctx.taskOutputs.review?.output?.verdict === "changes_requested",
              effect: () => ({ transitionTo: "ready" }),
            },
            {
              id: "restart_review",
              label: "Retry review",
              gate: (ctx) => ctx.taskOutputs.review?.status === "error",
              effect: () => ({ transitionTo: "reviewing" }),
            },
          ],
        },
        { id: "done", label: "Done" },
        {
          id: "unfulfillable",
          label: "Unfulfillable",
          tasks: [
            {
              id: "coordinate",
              label: "Analyze handover",
              trigger: "auto",
              role: "ai-task",
              tools: ["read_file", "search_code"],
              systemPrompt: "You are a coordinator...",
            },
          ],
          actions: [
            {
              id: "remediate",
              label: "Apply remediation",
              gate: (ctx) => ctx.taskOutputs.coordinate?.status === "success",
              effect: () => ({ transitionTo: "ready" }),
            },
            {
              id: "archive_card",
              label: "Archive",
              effect: () => ({ transitionTo: "done" }),
            },
          ],
        },
      ],
      initial: "ready",
      terminalStates: ["done"],
    }),
  ],
  edges: [
    {
      fromWorkflow: "ideas",
      fromStates: ["submitted"],
      toWorkflow: "requirements",
      transform: (source) => ({
        mergeDraft: source.elaborate?.output,
        triggerPlanning: true,
      }),
    },
    {
      fromWorkflow: "requirements",
      fromStates: ["accepted"],
      toWorkflow: "cards",
      transform: (source) => ({
        planOutcome: source.plan,
      }),
    },
  ],
} satisfies FlowDefinition;

// === TYPE ASSERTION TESTS ===
//
// These verify the workflow type system catches expected errors.
// Each line with @ts-expect-error suppresses an intentional compile
// error. If that line would NOT produce an error, the comment itself
// fails with "Unused '@ts-expect-error' directive."

// ——— StateDef rejects task ids not declared in TTaskOutputs ———

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _invalidTaskId: StateDef<{ implement: NoOutput }, "ready"> = {
  id: "ready",
  label: "R",
  tasks: [
    // @ts-expect-error: "bogus" is not a key of TTaskOutputs
    { id: "bogus", label: "", trigger: "manual", role: "ai-task" },
  ],
};

// ——— AutoTransition rejects state ids outside TStateId ———

const _invalidTransition: AutoTransition<NoOutput, "ready" | "done"> = {
  // @ts-expect-error: "bogus" is not assignable to "ready" | "done"
  to: "bogus",
  gate: () => true,
};

// ——— GateContext enforces optional chaining on task outputs ———

function _gateRequiresOptionalChain(
  ctx: GateContext<{ review: { verdict: string } }>
): boolean {
  // @ts-expect-error: ctx.taskOutputs.review is TaskOutcome | undefined —
  // accessing .output without ?. fails because undefined has no .output
  return ctx.taskOutputs.review.output.verdict === "approved";
}

// ——— Correct usage: optional chaining compiles ———

function _gateCompilesWithOptionalChain(
  ctx: GateContext<{ review: { verdict: string } }>
): boolean {
  return ctx.taskOutputs.review?.output?.verdict === "approved";
}

// ——— FlowEdge with explicit generic gives typed source output ———

const _typedEdge: FlowEdge<{ plan: { kind: string } }> = {
  fromWorkflow: "a",
  fromStates: ["x"],
  toWorkflow: "b",
  transform: (source) => {
    // source.plan?.output is typed as { kind: string } | undefined
    const _kind: string | undefined = source.plan?.output.kind;
    // @ts-expect-error: "foo" does not exist on { kind: string }
    const _bad = source.plan?.output.foo;
    return {};
  },
};
