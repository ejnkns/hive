import type {
  AutoTransition,
  FlowDefinition,
  FlowEdge,
  GateContext,
  NoOutput,
  StateDef,
} from "workflow-engine/workflow-types";
import { cardsWorkflow } from "./cards-workflow";
import { ideasWorkflow } from "./ideas-workflow";
import { queenBeeOperations } from "./operations";
import { requirementsWorkflow } from "./requirements-workflow";
import { queenBeeTools } from "./tools";

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
  workflows: [requirementsWorkflow, ideasWorkflow, cardsWorkflow],
  tools: queenBeeTools,
  operations: queenBeeOperations,
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
