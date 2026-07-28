import { createWorkflow } from "workflow-engine/workflow-types";

export type CardsTaskOutputs = {
  implement: Record<string, never>;
  review: { verdict: "approved" | "changes_requested" };
  coordinate: { summary: string };
};

export type CardsStateId =
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

export const cardsWorkflow = createWorkflow<CardsTaskOutputs, CardsStateId>()({
  id: "cards",
  label: "Cards",
  taskOutputs: {
    implement: {} as Record<string, never>,
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
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
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
});
