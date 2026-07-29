import { defineWorkflow } from "workflow-engine/workflow-types";

export type RequirementsTaskOutputs = {
  draft: { content: string; revision: string };
  plan: { kind: "proposal" | "feedback"; cards?: unknown[] };
};

export type RequirementsStateId =
  | "no_session"
  | "drafting"
  | "complete"
  | "planning"
  | "planned"
  | "accepted";

export const requirementsWorkflow = defineWorkflow({
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
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "no_session",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "no_session",
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
          transitionTo: "planning",
        },
        {
          id: "reset",
          label: "Reset",
          variant: "secondary",
          transitionTo: "no_session",
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
          variant: "primary",
          gate: (ctx) => ctx.taskOutputs.plan?.output.kind === "proposal",
          transitionTo: "planned",
        },
        {
          id: "repair",
          label: "Start repair session",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.plan?.output.kind === "feedback",
          transitionTo: "drafting",
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
          transitionTo: "accepted",
        },
        {
          id: "replan",
          label: "Request replanning",
          variant: "secondary",
          transitionTo: "complete",
        },
      ],
    },
    {
      id: "accepted",
      label: "Accepted",
      category: "terminal",
    },
  ],
  initial: "no_session",
  terminalStates: ["accepted"],
});
