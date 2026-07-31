import type {
  AutoTransition,
  FlowDefinition,
  FlowEdge,
  GateContext,
  NoOutput,
  RuntimeWorkflowConfig,
  StateDef,
} from "workflow-engine/workflow-types";
import { cardsWorkflow } from "./cards-workflow";
import { ideasWorkflow } from "./ideas-workflow";
import { integrationWorkflow } from "./integration-workflow";
import { onboardingWorkflow } from "./onboarding-workflow";
import { queenBeeOperations } from "./operations";
import { requirementsWorkflow } from "./requirements-workflow";
import { queenBeeTools } from "./tools";

// === QUEEN BEE FLOW ===
//
// The queen-bee project lifecycle expressed as five interacting workflows
// wired together by a FlowDefinition.
//
// Onboarding: turns a plain flow into a Project by binding a repository.
//    validating → ensuring → writing → binding → complete | failed
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
// Integration: fast-forward the target branch on demand.
//    ready → integrating → integrated
//
// Flow edges:
//    onboarding/complete → requirements (seed the project's requirements)
//    onboarding/complete → integration (seed the project's integration)
//    ideas/submitted → requirements (merge draft, trigger planning)
//    requirements/accepted → cards (create cards in ready)

const baseWorkflows = [
  onboardingWorkflow,
  requirementsWorkflow,
  ideasWorkflow,
  cardsWorkflow,
  integrationWorkflow,
];

// The queen-bee definition is a factory: flow config (maxConcurrentWorkers,
// systemPrompts) is resolved into the workflow definitions per flow at
// creation time. Static definitions without per-flow config use `workflows`.
function buildWorkflows(
  config: Record<string, unknown>
): RuntimeWorkflowConfig[] {
  const maxWorkers = readMaxWorkers(config);
  const systemPrompts = readSystemPrompts(config);

  return baseWorkflows.map((wf) => ({
    ...wf,
    states: wf.states.map((state) => ({
      ...state,
      actions: state.actions?.map((action) => {
        if (
          action.id === "run" &&
          wf.id === "cards" &&
          action.maxWorkflowInstancesInTarget !== undefined
        ) {
          return { ...action, maxWorkflowInstancesInTarget: maxWorkers };
        }
        return action;
      }),
      tasks: state.tasks?.map((task) => {
        if (task.systemPrompt && systemPrompts?.[task.id]) {
          return { ...task, systemPrompt: systemPrompts[task.id] };
        }
        return task;
      }),
    })),
  }));
}

function readMaxWorkers(config: Record<string, unknown>): number {
  const raw = config.maxConcurrentWorkers;
  return typeof raw === "number" ? raw : 3;
}

function readSystemPrompts(
  config: Record<string, unknown>
): Record<string, string> | undefined {
  const raw = config.systemPrompts;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export const queenBeeFlow = {
  id: "queen-bee",
  label: "Queen Bee",
  buildWorkflows,
  tools: queenBeeTools,
  operations: queenBeeOperations,
  edges: [
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "requirements",
      transform: () => ({}),
    },
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "integration",
      transform: () => ({}),
    },
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
