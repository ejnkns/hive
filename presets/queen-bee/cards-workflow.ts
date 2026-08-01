import { defineWorkflow } from "workflow-engine/workflow-types";

export type CardsTaskOutputs = {
  registerCard: { ok: boolean };
  prepareWorktree: {
    branchName: string;
    worktreePath: string;
    baseCommit: string;
  };
  runAgent: { content: string };
  validateCompletion: { ok: boolean };
  buildPackage: { packageId: string };
  review: { verdict: "approved" | "changes_requested"; findings: unknown[] };
  coordinate: { summary: string };
  syncDone: { ok: boolean };
  syncUnfulfillable: { ok: boolean };
};

export type CardsItemState = {
  projectId: string;
  repoPath: string;
  attempt: number;
  validationFailures: number;
  cardSpec?: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    dependsOn: string[];
  };
};

export type CardsStateId =
  | "ready"
  | "in_progress"
  | "running_agent"
  | "validating"
  | "reviewing"
  | "running_review"
  | "reviewed"
  | "done"
  | "unfulfillable";

export const cardsWorkflow = defineWorkflow({
  id: "cards",
  label: "Cards",
  description:
    "Per-card workflow: worktree, worker agent, completion gate, reviewer, coordinator.",
  taskOutputs: {
    registerCard: {} as { ok: boolean },
    prepareWorktree: {} as {
      branchName: string;
      worktreePath: string;
      baseCommit: string;
    },
    runAgent: {} as { content: string },
    validateCompletion: {} as { ok: boolean },
    buildPackage: {} as { packageId: string },
    review: {} as {
      verdict: "approved" | "changes_requested";
      findings: unknown[];
    },
    coordinate: {} as { summary: string },
    syncDone: {} as { ok: boolean },
    syncUnfulfillable: {} as { ok: boolean },
  },
  workflowInstanceState: {} as CardsItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      tasks: [
        {
          id: "registerCard",
          label: "Register on board",
          trigger: "auto",
          role: "operation",
          operations: ["sync_card_status"],
        },
      ],
      actions: [
        {
          id: "run",
          label: "Run Worker Agent",
          variant: "primary",
          maxWorkflowInstancesInTarget: 3,
          dependsOnState: "done",
          gate: (ctx) => !ctx.hasRunningTask,
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
          operations: ["sync_card_status", "prepare_worktree"],
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
            "submit_work",
          ],
          systemPrompt:
            "You are a feature implementer. Use commit_work to save changes and submit_work to signal completion.",
          operations: [],
        },
      ],
      autoTransitions: [
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
          operations: ["validate_completion"],
        },
      ],
      autoTransitions: [
        {
          to: "reviewing",
          gate: (ctx) =>
            ctx.taskOutputs.validateCompletion?.output?.ok === true,
        },
        {
          to: "unfulfillable",
          gate: (ctx) =>
            (ctx.workflowInstanceState.validationFailures ?? 0) >= 3,
        },
        {
          to: "running_agent",
          gate: (ctx) =>
            ctx.taskOutputs.validateCompletion?.status === "error" &&
            (ctx.workflowInstanceState.validationFailures ?? 0) < 3,
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
          operations: ["build_review_package", "sync_card_status"],
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
            "submit_review",
          ],
          completionTool: "submit_review",
          systemPrompt:
            "You are a code reviewer. Inspect the worker changes and submit a structured review.",
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
      actions: [
        {
          id: "accept",
          label: "Accept work",
          variant: "primary",
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
          transitionTo: "done",
        },
        {
          id: "accept_anyway",
          label: "Accept anyway",
          variant: "destructive",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          transitionTo: "done",
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
          transitionTo: "ready",
        },
        {
          id: "restart_review",
          label: "Retry review",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
          transitionTo: "running_review",
        },
      ],
    },
    {
      id: "done",
      label: "Done",
      category: "terminal",
      tasks: [
        {
          id: "syncDone",
          label: "Sync board",
          trigger: "auto",
          role: "operation",
          operations: ["sync_card_status"],
        },
      ],
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
          systemPrompt:
            "You are a coordinator. Analyze why the card could not be completed and suggest remediation.",
          operations: [],
        },
        {
          id: "syncUnfulfillable",
          label: "Sync board",
          trigger: "auto",
          role: "operation",
          operations: ["sync_card_status"],
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
