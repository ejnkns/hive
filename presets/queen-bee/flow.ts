import type {
  AutoTransition,
  ConfigField,
  FlowDefinition,
  FlowEdge,
  GateContext,
  NoOutput,
  StateDef,
} from "workflow-engine/workflow-types";
import type { CardSpec } from "./cards-workflow";
import { cardsOperations, cardsWorkflow } from "./cards-workflow";
import { ideasWorkflow } from "./ideas-workflow";
import {
  integrationOperations,
  integrationWorkflow,
} from "./integration-workflow";
import {
  onboardingOperations,
  onboardingWorkflow,
} from "./onboarding-workflow";
import type { PlanCard, PlanProposal } from "./requirements-workflow";
import {
  requirementsOperations,
  requirementsWorkflow,
} from "./requirements-workflow";
import { queenBeeTools } from "./tools";

// The merged domain operations across all workflows, keyed by the names the
// workflow tasks reference. Exported so tests can run them directly.
export const queenBeeOperations = {
  ...onboardingOperations,
  ...requirementsOperations,
  ...cardsOperations,
  ...integrationOperations,
};

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

export const queenBeeConfigSchema: ConfigField[] = [
  {
    key: "basePath",
    label: "Base path",
    type: "string",
    required: true,
    hint: "A git repository root or a plain directory to bind the flow to.",
  },
];

export const queenBeeFlow = {
  id: "queen-bee",
  label: "Queen Bee",
  description:
    "Project lifecycle: onboarding, requirements, ideas, cards, integration.",
  configSchema: queenBeeConfigSchema,
  domainDir: ".queen-bee",
  // A flow is static data: workflows, edges, tools, and operations. The engine
  // supplies all runtime machinery (runners, persistence, concurrency,
  // cross-instance gates) and reads runtime settings from flow config; the
  // definition itself resolves nothing per flow.
  workflows: [
    onboardingWorkflow,
    requirementsWorkflow,
    ideasWorkflow,
    cardsWorkflow,
    integrationWorkflow,
  ],
  tools: queenBeeTools,
  operations: queenBeeOperations,
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      variant: "primary",
      createInstance: {
        workflowId: "ideas",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
            hint: "A short statement of the idea.",
          },
          { key: "brief", label: "Brief", type: "string" },
        ],
      },
    },
    {
      id: "revise_requirements",
      label: "Revise requirements",
      variant: "secondary",
      dispatchToAll: { workflowId: "requirements", actionId: "start" },
    },
    {
      id: "integrate",
      label: "Integrate",
      variant: "secondary",
      dispatchToAll: { workflowId: "integration", actionId: "integrate" },
    },
  ],
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
      // Fan out: one cards instance per planned card. The transform runs with
      // the erased runtime output map; the plan task's structured output is
      // parsed by the planner's submit_plan completion tool.
      transform: (source) => {
        const plan = source.plan?.output as PlanProposal | undefined;
        if (plan?.kind !== "proposal") return [];
        return plan.cards.map((card: PlanCard) => ({
          cardSpec: {
            title: card.title,
            description: card.description,
            acceptanceCriteria: card.acceptanceCriteria,
            dependsOn: card.dependencies,
          } satisfies CardSpec,
          dependsOn: card.dependencies,
        }));
      },
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
