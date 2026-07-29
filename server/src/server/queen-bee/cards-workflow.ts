import { defineWorkflow, type NoOutput } from "workflow-engine/workflow-types";

export type CardsTaskOutputs = {
  implement: NoOutput;
  review: { verdict: "approved" | "changes_requested" };
  coordinate: { summary: string };
};

export type CardsStateId =
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

export const cardsWorkflow = defineWorkflow({
  id: "cards",
  label: "Cards",
  description: "Per-card workflow: worker agent, reviewer, coordinator.",
  taskOutputs: {
    implement: {} as NoOutput,
    review: {} as { verdict: "approved" | "changes_requested" },
    coordinate: {} as { summary: string },
  },
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
          effect: () => ({ transitionTo: "in_progress" }),
        },
      ],
    },
    {
      id: "in_progress",
      label: "In Progress",
      category: "active",
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
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          effect: () => ({ transitionTo: "ready" }),
        },
      ],
    },
    {
      id: "reviewing",
      label: "Reviewing",
      category: "active",
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
          variant: "primary",
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
          effect: () => ({ transitionTo: "done" }),
        },
        {
          id: "accept_anyway",
          label: "Accept anyway",
          variant: "destructive",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          effect: () => ({ transitionTo: "done" }),
        },
        {
          id: "update_changes",
          label: "Update work",
          variant: "secondary",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          effect: () => ({ transitionTo: "in_progress" }),
        },
        {
          id: "new_changes",
          label: "New attempt",
          variant: "secondary",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          effect: () => ({ transitionTo: "ready" }),
        },
        {
          id: "restart_review",
          label: "Retry review",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
          effect: () => ({ transitionTo: "reviewing" }),
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
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
          systemPrompt: "You are a coordinator...",
        },
      ],
      actions: [
        {
          id: "remediate",
          label: "Apply remediation",
          variant: "primary",
          gate: (ctx) => ctx.taskOutputs.coordinate?.status === "success",
          effect: () => ({ transitionTo: "ready" }),
        },
        {
          id: "archive_card",
          label: "Archive",
          variant: "secondary",
          effect: () => ({ transitionTo: "done" }),
        },
      ],
    },
  ],
  initial: "ready",
  terminalStates: ["done"],
});
