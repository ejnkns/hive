import { defineOperations } from "workflow-engine/runners";
import type {
  AutoTransition,
  ConfigField,
  FlowDefinition,
  FlowEdge,
  GateContext,
  NoOutput,
  StateDef,
} from "workflow-engine/workflow-types";
import { cardsOperations } from "./cards-workflow/operations.ts";
import type { CardSpec, CardsItemState } from "./cards-workflow.ts";
import { cardsWorkflow } from "./cards-workflow.ts";
import { ideaCardComponentSource } from "./ideas-card.ts";
import type { IdeasTaskOutputs } from "./ideas-workflow.ts";
import { ideasWorkflow } from "./ideas-workflow.ts";
import { integrationOperations } from "./integration-workflow/operations.ts";
import type { IntegrationItemState } from "./integration-workflow.ts";
import { integrationWorkflow } from "./integration-workflow.ts";
import { onboardingOperations } from "./onboarding-workflow/operations.ts";
import type {
  OnboardingItemState,
  OnboardingTaskOutputs,
} from "./onboarding-workflow.ts";
import { onboardingWorkflow } from "./onboarding-workflow.ts";
import { requirementsOperations } from "./requirements-workflow/operations.ts";
import type {
  PlanCard,
  PlanProposal,
  RequirementsItemState,
  RequirementsTaskOutputs,
} from "./requirements-workflow.ts";
import { requirementsWorkflow } from "./requirements-workflow.ts";
import { queenBeeTools } from "./tools.ts";

// The merged domain operations across all workflows, keyed by the names the
// workflow tasks reference. Each group's state type is bound here — the
// assembly point where the workflows and their operations meet — then erased
// for the shared name-resolved registry. Exported so tests can run them
// directly.
export const queenBeeOperations = {
  ...defineOperations<OnboardingItemState>(onboardingOperations),
  ...defineOperations<RequirementsItemState>(requirementsOperations),
  ...defineOperations<CardsItemState>(cardsOperations),
  ...defineOperations<IntegrationItemState>(integrationOperations),
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
  // Served-at-runtime component modules: the ideas card replaces the default
  // workflow-instance card for the ideas workflow (ui.instanceComponent). The
  // server transpiles and serves each source; the rendering surface fetches,
  // evaluates, and registers it — proving the mechanism with a real flow.
  ui: {
    components: {
      "idea-card": ideaCardComponentSource,
    },
  },
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
    } satisfies FlowEdge<OnboardingTaskOutputs, RequirementsItemState>,
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "integration",
      transform: () => ({}),
    } satisfies FlowEdge<OnboardingTaskOutputs, IntegrationItemState>,
    {
      fromWorkflow: "ideas",
      fromStates: ["submitted"],
      toWorkflow: "requirements",
      transform: () => ({}),
    } satisfies FlowEdge<IdeasTaskOutputs, RequirementsItemState>,
    {
      fromWorkflow: "requirements",
      fromStates: ["accepted"],
      toWorkflow: "cards",
      // Fan out: one cards instance per planned card. The transform runs with
      // the erased runtime output map; the plan task's structured output is
      // parsed by the planner's submit_plan completion tool. Typed against
      // CardsItemState so a misspelled or undeclared field fails to compile.
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
    } satisfies FlowEdge<RequirementsTaskOutputs, CardsItemState>,
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
