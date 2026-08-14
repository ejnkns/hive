import { defineTool } from "workflow-engine/runners";
import {
  type CompiledFlowDefinition,
  defineWorkflow,
  type FlowEdge,
} from "workflow-engine/workflow-types";
import { build_review_packageOperations } from "./cards/ops/build-review-package.ts";
import { check_review_freshnessOperations } from "./cards/ops/check-review-freshness.ts";
import { coordinator } from "./cards/prompts/coordinator.ts";
import { reviewer } from "./cards/prompts/reviewer.ts";
import { worker } from "./cards/prompts/worker.ts";
import { elaboration } from "./ideas/prompts/elaboration.ts";
import { fast_forward_target_branchOperations } from "./integration/ops/fast-forward-target-branch.ts";
import { ensure_integration_branchOperations } from "./onboarding/ops/ensure-integration-branch.ts";
import { write_project_metadataOperations } from "./onboarding/ops/write-project-metadata.ts";
import { draftRecorded } from "./requirements/gates/draft-recorded.ts";
import { clear_requirements_stateOperations } from "./requirements/ops/clear-requirements-state.ts";
import { finalize_requirementsOperations } from "./requirements/ops/finalize-requirements.ts";
import { draft } from "./requirements/prompts/draft.ts";
import { planner } from "./requirements/prompts/planner.ts";
import { update_requirements_draftTools } from "./tools/update-requirements-draft.ts";

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

type OnboardingTaskOutputs = {
  configureFlow?: Record<string, never>;
  validateRepo?: Record<string, never>;
  ensureIntegrationBranch?: Record<string, never>;
  writeProjectMetadata?: Record<string, never>;
  commitState?: Record<string, never>;
  bindFlow?: Record<string, never>;
};

const onboardingWf = defineWorkflow({
  id: "onboarding",
  label: "Onboarding",
  description:
    "Bind a repository to a flow: configure the git identity, validate, ensure the integration branch, write project metadata, patch flow config.",
  ui: { view: "list" },
  taskOutputs: {} as OnboardingTaskOutputs,
  workflowInstanceState: {} as Record<string, unknown>,
  states: [
    {
      id: "configuring",
      label: "Configuring",
      category: "initial",
      tasks: [
        {
          id: "configureFlow",
          label: "Configure git identity",
          trigger: "auto",
          role: "operation",
          operations: ["patch_flow_config"],
          operationInputs: {
            integrationBranch: "queen-bee-main",
            branchPrefix: "queen-bee/",
            domainDir: ".queen-bee",
          },
        },
      ],
      autoTransitions: [
        {
          to: "validating",
          gate: (ctx) => ctx.taskOutputs.configureFlow?.status === "success",
        },
      ],
    },
    {
      id: "validating",
      label: "Validating",
      category: "active",
      tasks: [
        {
          id: "validateRepo",
          label: "Validate repository",
          trigger: "auto",
          role: "operation",
          operations: ["validate_repo"],
        },
      ],
      autoTransitions: [
        {
          to: "ensuring",
          gate: (ctx) => ctx.taskOutputs.validateRepo?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.validateRepo?.status === "error",
        },
      ],
    },
    {
      id: "ensuring",
      label: "Ensuring Integration Branch",
      category: "active",
      tasks: [
        {
          id: "ensureIntegrationBranch",
          label: "Ensure integration branch",
          trigger: "auto",
          role: "operation",
          operations: ["ensure_integration_branch"],
        },
      ],
      autoTransitions: [
        {
          to: "writing",
          gate: (ctx) =>
            ctx.taskOutputs.ensureIntegrationBranch?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.ensureIntegrationBranch?.status === "error",
        },
      ],
    },
    {
      id: "writing",
      label: "Writing project metadata",
      category: "active",
      tasks: [
        {
          id: "writeProjectMetadata",
          label: "Write project metadata",
          trigger: "auto",
          role: "operation",
          operations: ["write_project_metadata"],
          persist: { path: "project.json" },
        },
        {
          id: "commitState",
          label: "Commit project metadata",
          trigger: "auto",
          role: "operation",
          operations: ["commit_flow_state"],
        },
      ],
      autoTransitions: [
        {
          to: "binding",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.status === "success" &&
            ctx.taskOutputs.commitState?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.status === "error" ||
            ctx.taskOutputs.commitState?.status === "error",
        },
      ],
    },
    {
      id: "binding",
      label: "Binding flow config",
      category: "active",
      tasks: [
        {
          id: "bindFlow",
          label: "Bind repository to flow config",
          trigger: "auto",
          role: "operation",
          operations: ["patch_flow_config"],
          operationInputs: {
            basePath: "@flow:basePath",
            targetBranch: "@flow:targetBranch",
            name: "@flow:name",
          },
        },
      ],
      autoTransitions: [
        {
          to: "complete",
          gate: (ctx) => ctx.taskOutputs.bindFlow?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.bindFlow?.status === "error",
        },
      ],
    },
    {
      id: "complete",
      label: "Complete",
      category: "terminal",
    },
    {
      id: "failed",
      label: "Failed",
      category: "error",
      actions: [
        {
          id: "retry",
          label: "Retry onboarding",
          variant: "secondary",
          transitionTo: "validating",
        },
      ],
    },
  ],
  initial: "configuring",
  terminalStates: ["complete"],
});

type RequirementsItemState = {
  requirementsDraft?: string;
};

type RequirementsTaskOutputs = {
  draft?: Record<string, never>;
  plan?: {
    kind?: string;
    guidance?: string;
    cards?: Array<Record<string, unknown>>;
  };
  finalizeRequirements?: Record<string, never>;
  commitState?: Record<string, never>;
  clearRequirements?: Record<string, never>;
};

export const requirementsCompletionTools = [
  defineTool({
    name: "requirements_plan_complete",
    description:
      "Complete the Run planner task, returning the declared fields: kind (string), guidance (string), cards (object[]).",
    parameters: {
      properties: {
        kind: { type: "string", description: '"proposal" or "feedback".' },
        guidance: {
          type: "string",
          description:
            "Required when kind is feedback: what to revise and why.",
        },
        cards: {
          type: "array",
          items: { type: "object" },
          description:
            "Required when kind is proposal: one entry per card, each shaped { cardSpec: { title, description, acceptanceCriteria }, dependencies }.",
        },
      },
      required: ["kind", "guidance", "cards"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
];

const requirementsWf = defineWorkflow({
  id: "requirements",
  label: "Requirements",
  ui: { view: "document" },
  taskOutputs: {} as RequirementsTaskOutputs,
  workflowInstanceState: {} as RequirementsItemState,
  states: [
    {
      id: "no_session",
      label: "No Session",
      category: "initial",
      actions: [
        {
          id: "start",
          label: "Start requirements session",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "drafting",
        },
      ],
    },
    {
      id: "drafting",
      label: "Drafting",
      category: "active",
      tasks: [
        {
          id: "draft",
          label: "Requirements session",
          trigger: "auto",
          role: "ai-chat",
          tools: [
            "list_directory",
            "read_file",
            "search_code",
            "update_requirements_draft",
          ],
          completionSignal: "REQUIREMENTS_COMPLETE",
          systemPrompt: draft,
          startOnUserInput: true,
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
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "no_session",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "complete",
      label: "Complete",
      category: "active",
      actions: [
        {
          id: "approve",
          label: "Submit for planning",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask && draftRecorded(ctx),
          transitionTo: "planning",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "planning",
      label: "Planning",
      category: "active",
      tasks: [
        {
          id: "plan",
          label: "Run planner",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code", "requirements_plan_complete"],
          completionTool: "requirements_plan_complete",
          systemPrompt: planner,
          inputFromInstanceState: "requirementsDraft",
        },
      ],
      actions: [
        {
          id: "accept_proposal",
          label: "Accept proposal",
          variant: "primary",
          gate: (ctx) =>
            !ctx.hasRunningTask &&
            ctx.taskOutputs.plan?.output?.kind === "proposal",
          transitionTo: "planned",
        },
        {
          id: "repair",
          label: "Start repair session",
          variant: "secondary",
          gate: (ctx) =>
            !ctx.hasRunningTask &&
            ctx.taskOutputs.plan?.output?.kind === "feedback",
          transitionTo: "drafting",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "planned",
      label: "Planned",
      category: "active",
      actions: [
        {
          id: "accept_all",
          label: "Accept all and create cards",
          variant: "primary",
          transitionTo: "finalizing",
        },
        {
          id: "replan",
          label: "Request replanning",
          variant: "secondary",
          transitionTo: "complete",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "finalizing",
      label: "Finalizing",
      category: "active",
      tasks: [
        {
          id: "finalizeRequirements",
          label: "Write requirements document",
          trigger: "auto",
          role: "operation",
          operations: ["finalize_requirements"],
          persist: { path: "requirements.md" },
        },
        {
          id: "commitState",
          label: "Commit requirements document",
          trigger: "auto",
          role: "operation",
          operations: ["commit_flow_state"],
        },
      ],
      autoTransitions: [
        {
          to: "accepted",
          gate: (ctx) =>
            ctx.taskOutputs.finalizeRequirements?.status === "success" &&
            ctx.taskOutputs.commitState?.status === "success",
        },
        {
          to: "complete",
          gate: (ctx) =>
            ctx.taskOutputs.finalizeRequirements?.status === "error" ||
            ctx.taskOutputs.commitState?.status === "error",
        },
      ],
      actions: [
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "accepted",
      label: "Accepted",
      category: "terminal",
      actions: [
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "clearing",
        },
      ],
    },
    {
      id: "clearing",
      label: "Clearing",
      category: "active",
      tasks: [
        {
          id: "clearRequirements",
          label: "Clear requirements state",
          trigger: "auto",
          role: "operation",
          operations: ["clear_requirements_state"],
        },
      ],
      autoTransitions: [
        {
          to: "no_session",
          gate: (ctx) =>
            ctx.taskOutputs.clearRequirements?.status === "success",
        },
      ],
    },
  ],
  initial: "no_session",
  terminalStates: ["accepted"],
});

type IdeasItemState = {
  title?: string;
  brief?: string;
};

type IdeasTaskOutputs = {
  elaborate?: Record<string, never>;
};

const ideasWf = defineWorkflow({
  id: "ideas",
  label: "Ideas",
  instance: { title: "title" },
  ui: { view: "list", instanceComponent: "idea-card" },
  taskOutputs: {} as IdeasTaskOutputs,
  workflowInstanceState: {} as IdeasItemState,
  states: [
    {
      id: "backlog",
      label: "Backlog",
      category: "initial",
      actions: [
        {
          id: "elaborate",
          label: "Elaborate idea",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "elaborating",
        },
        {
          id: "archive",
          label: "Archive",
          variant: "secondary",
          transitionTo: "archived",
        },
      ],
    },
    {
      id: "elaborating",
      label: "Elaborating",
      category: "active",
      tasks: [
        {
          id: "elaborate",
          label: "Elaborate session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code"],
          completionSignal: "IDEA_COMPLETE",
          systemPrompt: elaboration,
          startOnUserInput: true,
          inputFromInstanceState: "brief",
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
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "backlog",
        },
      ],
    },
    {
      id: "refined",
      label: "Refined",
      category: "active",
      actions: [
        {
          id: "approve",
          label: "Submit for planning",
          variant: "primary",
          transitionTo: "submitted",
        },
        {
          id: "reopen",
          label: "Reopen",
          variant: "secondary",
          transitionTo: "backlog",
        },
      ],
    },
    {
      id: "submitted",
      label: "Submitted",
      category: "active",
    },
    {
      id: "archived",
      label: "Archived",
      category: "terminal",
    },
  ],
  initial: "backlog",
  terminalStates: ["submitted", "archived"],
});

type CardsItemState = {
  attempt?: number;
  reviewIsStale?: boolean;
  worktreePath?: string;
  branchName?: string;
  cardSpec?: Record<string, unknown>;
  dependsOn?: string[];
};

type CardsTaskOutputs = {
  prepareWorktree?: Record<string, never>;
  runAgent?: {
    content?: string;
    completion?: {
      outcome?: string;
      verificationCallIds?: string[];
      verificationNotRunReason?: string;
      noChangeRationale?: string;
    };
  };
  validateCompletion?: Record<string, never>;
  buildPackage?: Record<string, never>;
  review?: {
    verdict?: string;
    recommendedApproach?: string;
    findings?: Array<Record<string, unknown>>;
    verificationAssessment?: Record<string, unknown>;
  };
  checkFreshness?: Record<string, never>;
  mergeWork?: Record<string, never>;
  coordinate?: Record<string, never>;
};

export const cardsCompletionTools = [
  defineTool({
    name: "cards_runAgent_complete",
    description:
      "Complete the Run worker agent task, returning the declared fields: outcome (string), verificationCallIds (string[]), verificationNotRunReason (string), noChangeRationale (string).",
    parameters: {
      properties: {
        outcome: {
          type: "string",
          description: '"implemented" or "already_satisfied".',
        },
        verificationCallIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Successful run_command tool call IDs that verified the current commit.",
        },
        verificationNotRunReason: {
          type: "string",
          description:
            "Why no applicable automated check exists, when verification was not run.",
        },
        noChangeRationale: {
          type: "string",
          description:
            "Precise rationale when the behavior was already present.",
        },
      },
      required: [
        "outcome",
        "verificationCallIds",
        "verificationNotRunReason",
        "noChangeRationale",
      ],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "cards_review_complete",
    description:
      "Complete the Run reviewer agent task, returning the declared fields: verdict (string), recommendedApproach (string), findings (object[]), verificationAssessment (object).",
    parameters: {
      properties: {
        verdict: {
          type: "string",
          description: '"approved" or "changes_requested".',
        },
        recommendedApproach: {
          type: "string",
          description: '"update" or "new".',
        },
        findings: {
          type: "array",
          items: { type: "object" },
          description:
            "Each finding: severity, requirement, evidence, recommendation.",
        },
        verificationAssessment: {
          type: "object",
          description: '{ status: "sufficient" | "insufficient", notes }.',
        },
      },
      required: [
        "verdict",
        "recommendedApproach",
        "findings",
        "verificationAssessment",
      ],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
];

const cardsWf = defineWorkflow({
  id: "cards",
  label: "Cards",
  description:
    "Per-card workflow: worktree, worker agent, completion gate, reviewer, coordinator.",
  instance: { title: "cardSpec.title" },
  ui: {
    view: "board",
    columns: [
      { id: "ready", label: "Ready", states: ["ready"] },
      {
        id: "in_progress",
        label: "In Progress",
        states: ["in_progress", "running_agent", "validating"],
      },
      {
        id: "reviewing",
        label: "Reviewing",
        states: ["reviewing", "running_review", "reviewed", "accepting"],
      },
      { id: "done", label: "Done", states: ["done"] },
      {
        id: "unfulfillable",
        label: "Unfulfillable",
        states: ["unfulfillable"],
      },
    ],
  },
  display: {
    fields: [
      {
        path: "cardSpec",
        label: "Card spec",
        render: {
          kind: "card",
          props: {
            title: "title",
            description: "description",
            bullets: "acceptanceCriteria",
          },
        },
      },
      { path: "dependsOn", label: "Depends on" },
    ],
  },
  taskOutputs: {} as CardsTaskOutputs,
  workflowInstanceState: {} as CardsItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "run",
          label: "Run Worker Agent",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          maxWorkflowInstancesInTarget: 3,
          dependsOnState: "done",
          transitionTo: "in_progress",
        },
      ],
    },
    {
      id: "in_progress",
      label: "In Progress",
      category: "active",
      tasks: [
        {
          id: "prepareWorktree",
          label: "Prepare worktree",
          trigger: "auto",
          role: "operation",
          operations: ["prepare_worktree"],
        },
      ],
      autoTransitions: [
        {
          to: "running_agent",
          gate: (ctx) => ctx.taskOutputs.prepareWorktree?.status === "success",
        },
        {
          to: "unfulfillable",
          gate: (ctx) => ctx.taskOutputs.prepareWorktree?.status === "error",
        },
      ],
      actions: [
        {
          id: "cancel",
          label: "Cancel",
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "ready",
        },
      ],
    },
    {
      id: "running_agent",
      label: "Running Agent",
      category: "active",
      tasks: [
        {
          id: "runAgent",
          label: "Run worker agent",
          trigger: "auto",
          role: "ai-chat",
          tools: [
            "read_file",
            "write_file",
            "run_command",
            "git_status",
            "git_diff",
            "git_log",
            "commit_work",
            "cards_runAgent_complete",
          ],
          completionTool: "cards_runAgent_complete",
          systemPrompt: worker,
          workspacePath: "@instance:worktreePath",
        },
      ],
      autoTransitions: [
        {
          to: "reviewing",
          gate: (ctx) =>
            ctx.taskOutputs.runAgent?.output?.completion?.outcome ===
            "already_satisfied",
        },
        {
          to: "validating",
          gate: (ctx) => ctx.taskOutputs.runAgent?.status === "success",
        },
        {
          to: "unfulfillable",
          gate: (ctx) => ctx.taskOutputs.runAgent?.status === "error",
        },
      ],
    },
    {
      id: "validating",
      label: "Validating",
      category: "active",
      tasks: [
        {
          id: "validateCompletion",
          label: "Validate completion",
          trigger: "auto",
          role: "operation",
          operations: ["verify_workspace"],
          operationInputs: { require: "committed" },
        },
      ],
      autoTransitions: [
        {
          to: "reviewing",
          gate: (ctx) =>
            ctx.taskOutputs.validateCompletion?.status === "success",
        },
        {
          to: "unfulfillable",
          gate: (ctx) => (ctx.taskErrorCounts.validateCompletion ?? 0) >= 3,
        },
        {
          to: "running_agent",
          gate: (ctx) =>
            ctx.taskOutputs.validateCompletion?.status === "error" &&
            !((ctx.taskErrorCounts.validateCompletion ?? 0) >= 3),
        },
      ],
    },
    {
      id: "reviewing",
      label: "Reviewing",
      category: "active",
      tasks: [
        {
          id: "buildPackage",
          label: "Build review package",
          trigger: "auto",
          role: "operation",
          operations: ["build_review_package"],
          persist: { path: "reviews/{instanceId}-{attempt}.json" },
        },
      ],
      autoTransitions: [
        {
          to: "running_review",
          gate: (ctx) => ctx.taskOutputs.buildPackage?.status === "success",
        },
      ],
    },
    {
      id: "running_review",
      label: "Running Review",
      category: "active",
      tasks: [
        {
          id: "review",
          label: "Run reviewer agent",
          trigger: "auto",
          role: "ai-task",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "git_diff",
            "git_log",
            "git_show",
            "cards_review_complete",
          ],
          completionTool: "cards_review_complete",
          systemPrompt: reviewer,
          workspacePath: "@instance:worktreePath",
        },
      ],
      autoTransitions: [
        {
          to: "reviewed",
          gate: (ctx) => ctx.taskOutputs.review?.status === "success",
        },
      ],
    },
    {
      id: "reviewed",
      label: "Reviewed",
      category: "active",
      tasks: [
        {
          id: "checkFreshness",
          label: "Check review freshness",
          trigger: "auto",
          role: "operation",
          operations: ["check_review_freshness"],
        },
      ],
      actions: [
        {
          id: "accept",
          label: "Accept work",
          variant: "primary",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "approved" &&
            !(ctx.workflowInstanceState.reviewIsStale === true),
          transitionTo: "accepting",
        },
        {
          id: "accept_anyway",
          label: "Accept anyway",
          variant: "destructive",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested" &&
            !(ctx.workflowInstanceState.reviewIsStale === true),
          transitionTo: "accepting",
        },
        {
          id: "update_changes",
          label: "Update work",
          variant: "secondary",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          transitionTo: "in_progress",
        },
        {
          id: "new_changes",
          label: "New attempt",
          variant: "secondary",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          newAttempt: true,
          transitionTo: "ready",
        },
        {
          id: "restart_review",
          label: "Retry review",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
          transitionTo: "running_review",
        },
        {
          id: "re_review",
          label: "Re-review",
          variant: "secondary",
          gate: (ctx) => ctx.workflowInstanceState.reviewIsStale === true,
          transitionTo: "reviewing",
        },
      ],
    },
    {
      id: "accepting",
      label: "Accepting",
      category: "active",
      tasks: [
        {
          id: "mergeWork",
          label: "Merge work",
          trigger: "auto",
          role: "operation",
          operations: ["merge_branch"],
        },
      ],
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.mergeWork?.status === "success",
        },
        {
          to: "reviewed",
          gate: (ctx) => ctx.taskOutputs.mergeWork?.status === "error",
        },
      ],
    },
    {
      id: "done",
      label: "Done",
      category: "terminal",
    },
    {
      id: "unfulfillable",
      label: "Unfulfillable",
      category: "error",
      tasks: [
        {
          id: "coordinate",
          label: "Analyze handover",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code"],
          systemPrompt: coordinator,
          workspacePath: "@instance:worktreePath",
        },
      ],
      actions: [
        {
          id: "remediate",
          label: "Apply remediation",
          variant: "primary",
          gate: (ctx) => ctx.taskOutputs.coordinate?.status === "success",
          transitionTo: "ready",
        },
        {
          id: "archive_card",
          label: "Archive",
          variant: "secondary",
          transitionTo: "done",
        },
      ],
    },
  ],
  initial: "ready",
  terminalStates: ["done"],
});

type IntegrationTaskOutputs = {
  commitState?: Record<string, never>;
  integrate?: Record<string, never>;
};

const integrationWf = defineWorkflow({
  id: "integration",
  label: "Integration",
  description:
    "Fast-forward the target branch to the integration branch on demand.",
  ui: { view: "list" },
  taskOutputs: {} as IntegrationTaskOutputs,
  workflowInstanceState: {} as Record<string, unknown>,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "integrate",
          label: "Integrate",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "integrating",
        },
      ],
    },
    {
      id: "integrating",
      label: "Integrating",
      category: "active",
      tasks: [
        {
          id: "commitState",
          label: "Commit flow state",
          trigger: "auto",
          role: "operation",
          operations: ["commit_flow_state"],
        },
        {
          id: "integrate",
          label: "Fast-forward target branch",
          trigger: "auto",
          role: "operation",
          operations: ["fast_forward_target_branch"],
        },
      ],
      autoTransitions: [
        {
          to: "integrated",
          gate: (ctx) =>
            ctx.taskOutputs.commitState?.status === "success" &&
            ctx.taskOutputs.integrate?.status === "success",
        },
        {
          to: "ready",
          gate: (ctx) => ctx.taskOutputs.integrate?.status === "error",
        },
      ],
    },
    {
      id: "integrated",
      label: "Integrated",
      category: "terminal",
    },
  ],
  initial: "ready",
  terminalStates: ["integrated"],
});

export const flow = {
  id: "queen-bee",
  label: "Queen Bee",
  description:
    "Project lifecycle: onboarding, requirements, ideas, cards, integration.",
  configSchema: [
    {
      key: "basePath",
      label: "Base path",
      type: "string",
      required: true,
      hint: "A git repository root or a plain directory to bind the flow to.",
    },
  ],
  domainDir: ".queen-bee",
  ui: {
    components: {
      "idea-card":
        'export default function (lit) {\n  const { LitElement, html, css } = lit;\n\n  class IdeaCard extends LitElement {\n    static properties = {\n      workflowDef: { attribute: false },\n      instanceEntry: { attribute: false },\n      onAction: { attribute: false },\n      onSendMessage: { attribute: false },\n    };\n\n    static styles = css`\n      :host {\n        display: block;\n      }\n      .idea {\n        border: 1px solid var(--border);\n        border-radius: 8px;\n        background: var(--surface);\n        padding: 0.75rem 0.875rem;\n        display: flex;\n        flex-direction: column;\n        gap: 0.5rem;\n      }\n      .idea-title {\n        font-weight: 700;\n        font-size: 0.8125rem;\n        color: var(--text);\n      }\n      .idea-state {\n        font-size: 0.5625rem;\n        text-transform: uppercase;\n        letter-spacing: 0.06em;\n        color: var(--muted);\n      }\n      .idea-spec {\n        font-size: 0.6875rem;\n        line-height: 1.5;\n        color: var(--text);\n        white-space: pre-wrap;\n        margin: 0;\n      }\n      .idea-chat {\n        display: flex;\n        flex-direction: column;\n        gap: 0.375rem;\n      }\n      .idea-msg {\n        font-size: 0.625rem;\n        color: var(--text);\n      }\n      .idea-input-row {\n        display: flex;\n        gap: 0.375rem;\n      }\n      input {\n        flex: 1;\n        font-family: inherit;\n        font-size: 0.625rem;\n        padding: 0.25rem 0.5rem;\n        border: 1px solid var(--border);\n        border-radius: 4px;\n        background: var(--bg);\n        color: var(--text);\n        outline: none;\n      }\n      button {\n        font-family: inherit;\n        font-size: 0.625rem;\n        height: 24px;\n        padding: 0 0.5rem;\n        border-radius: 4px;\n        border: 1px solid var(--border);\n        background: var(--success);\n        color: var(--bg);\n        cursor: pointer;\n      }\n      .idea-actions {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 0.375rem;\n      }\n    `;\n\n    render() {\n      const state = this.instanceEntry.state;\n      const title = state.workflowInstanceState.title ?? this.instanceEntry.id;\n      const stateDef = this.workflowDef.states.find(\n        (s) => s.id === state.currentState\n      );\n      const elaborate = state.taskOutputs.elaborate;\n      const spec =\n        elaborate !== undefined &&\n        elaborate.status === "success" &&\n        elaborate.output !== undefined\n          ? (elaborate.output.elaboratedSpec ?? "")\n          : "";\n      const actions = this.instanceEntry.availableActions ?? [];\n      const running =\n        state.hasRunningTask && state.runningTaskContext !== null\n          ? state.runningTaskContext\n          : null;\n      return html`\n        <div class="idea">\n          <div class="idea-title">${title}</div>\n          <div class="idea-state">\n            ${stateDef !== undefined ? stateDef.label : state.currentState}\n          </div>\n          ${running !== null && running.role === "ai-chat"\n            ? html`<div class="idea-chat">\n                ${(running.messages ?? []).map(\n                  (m) =>\n                    html`<div class="idea-msg">${m.role}: ${m.content}</div>`\n                )}\n                <div class="idea-input-row">\n                  <input\n                    placeholder="Message the elaborating agent..."\n                    @input=${(e) => {\n                      this.input = e.target.value;\n                    }}\n                    @keydown=${(e) => {\n                      if (e.key === "Enter") this.send();\n                    }}\n                  />\n                  <button\n                    @click=${() => {\n                      this.send();\n                    }}\n                  >\n                    Send\n                  </button>\n                </div>\n              </div>`\n            : ""}\n          ${spec !== "" ? html`<pre class="idea-spec">${spec}</pre>` : ""}\n          ${actions.length > 0\n            ? html`<div class="idea-actions">\n                ${actions.map(\n                  (a) =>\n                    html`<button\n                      @click=${() => {\n                        if (this.onAction !== undefined) this.onAction(a.id);\n                      }}\n                    >\n                      ${a.label}\n                    </button>`\n                )}\n              </div>`\n            : ""}\n        </div>\n      `;\n    }\n\n    send() {\n      const text = this.input.trim();\n      if (text !== "" && this.onSendMessage !== undefined) {\n        this.onSendMessage(text);\n        this.input = "";\n      }\n    }\n  }\n\n  return { components: { "idea-card": IdeaCard } };\n}\n',
    },
  },
  workflows: [onboardingWf, requirementsWf, ideasWf, cardsWf, integrationWf],
  operations: {
    ...ensure_integration_branchOperations,
    ...write_project_metadataOperations,
    ...finalize_requirementsOperations,
    ...clear_requirements_stateOperations,
    ...build_review_packageOperations,
    ...check_review_freshnessOperations,
    ...fast_forward_target_branchOperations,
  },
  tools: [
    ...update_requirements_draftTools,
    ...requirementsCompletionTools,
    ...cardsCompletionTools,
  ],
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
    } satisfies FlowEdge,
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "integration",
      transform: () => ({}),
    } satisfies FlowEdge,
    {
      fromWorkflow: "ideas",
      fromStates: ["submitted"],
      toWorkflow: "requirements",
      transform: () => ({}),
    } satisfies FlowEdge,
    {
      fromWorkflow: "requirements",
      fromStates: ["accepted"],
      toWorkflow: "cards",
      transform: (source) => {
        const items =
          (readPath(source.plan, "output.cards") as
            | Array<Record<string, unknown>>
            | undefined) ?? [];
        return items.map((item) => ({
          cardSpec: readPath(item, "cardSpec") as
            | Record<string, unknown>
            | undefined,
          dependsOn: readPath(item, "dependencies") as string[] | undefined,
        }));
      },
    } satisfies FlowEdge,
  ],
} satisfies CompiledFlowDefinition;
