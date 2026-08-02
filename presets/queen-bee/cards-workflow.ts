import { defineWorkflow } from "workflow-engine/workflow-types";
import type { ReviewPackage } from "./domain-state";

export type CardsTaskOutputs = {
  prepareWorktree: {
    branchName: string;
    worktreePath: string;
    baseCommit: string;
  };
  runAgent: { content: string };
  validateCompletion: {
    ok: boolean;
    commitCount?: number;
    branchName?: string;
  };
  buildPackage: ReviewPackage;
  review: { verdict: "approved" | "changes_requested"; findings: unknown[] };
  checkFreshness: { ok: boolean; reviewIsStale: boolean };
  mergeWork: {
    ok: boolean;
    skipped?: boolean;
    revision?: string;
    merged?: string;
  };
  coordinate: { summary: string };
};

export type CardsItemState = {
  projectId: string;
  attempt: number;
  validationFailures: number;
  reviewIsStale?: boolean;
  worktreePath?: string;
  branchName?: string;
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
  | "accepting"
  | "done"
  | "unfulfillable";

export const cardsWorkflow = defineWorkflow({
  id: "cards",
  label: "Cards",
  description:
    "Per-card workflow: worktree, worker agent, completion gate, reviewer, coordinator.",
  item: { title: "cardSpec.title" },
  taskOutputs: {
    prepareWorktree: {} as {
      branchName: string;
      worktreePath: string;
      baseCommit: string;
    },
    runAgent: {} as { content: string },
    validateCompletion: {} as {
      ok: boolean;
      commitCount?: number;
      branchName?: string;
    },
    buildPackage: {} as ReviewPackage,
    review: {} as {
      verdict: "approved" | "changes_requested";
      findings: unknown[];
    },
    checkFreshness: {} as { ok: boolean; reviewIsStale: boolean },
    mergeWork: {} as {
      ok: boolean;
      skipped?: boolean;
      revision?: string;
      merged?: string;
    },
    coordinate: {} as { summary: string },
  },
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
          workspacePath: "@instance:worktreePath",
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
          completionTool: "submit_work",
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
            ctx.taskOutputs.validateCompletion?.status === "success",
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
          workspacePath: "@instance:worktreePath",
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
            ctx.workflowInstanceState.reviewIsStale !== true,
          transitionTo: "accepting",
        },
        {
          id: "accept_anyway",
          label: "Accept anyway",
          variant: "destructive",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested" &&
            ctx.workflowInstanceState.reviewIsStale !== true,
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
          // A stale review must be re-built against the current integration
          // head (reviewing runs build_review_package), otherwise re-running
          // the reviewer on the same package keeps the reviewIsStale flag set
          // and accept stays blocked forever.
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
          // Merge failure returns to reviewed with the attempt and its
          // worktree preserved so the user can retry or re-review.
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
          workspacePath: "@instance:worktreePath",
          tools: ["read_file", "search_code"],
          systemPrompt:
            "You are a coordinator. Analyze why the card could not be completed and suggest remediation.",
          operations: [],
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
