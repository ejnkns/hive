import { createWorkflow } from "workflow-engine/workflow-types";

export type IdeasTaskOutputs = {
  elaborate: { ideaBrief: string; elaboratedSpec: string };
};

export type IdeasStateId =
  | "backlog"
  | "elaborating"
  | "refined"
  | "submitted"
  | "archived";

export const ideasWorkflow = createWorkflow<IdeasTaskOutputs, IdeasStateId>()({
  id: "ideas",
  label: "Ideas",
  taskOutputs: {
    elaborate: {} as { ideaBrief: string; elaboratedSpec: string },
  },
  states: [
    {
      id: "backlog",
      label: "Backlog",
      actions: [
        {
          id: "elaborate",
          label: "Elaborate idea",
          gate: (ctx) => !ctx.hasRunningTask,
          effect: () => ({ transitionTo: "elaborating" }),
        },
        {
          id: "archive",
          label: "Archive",
          effect: () => ({ transitionTo: "archived" }),
        },
      ],
    },
    {
      id: "elaborating",
      label: "Elaborating",
      description:
        "Multi-turn idea elaboration session. " +
        "Produces a requirements draft for this idea.",
      tasks: [
        {
          id: "elaborate",
          label: "Elaborate session",
          trigger: "manual",
          role: "ai-chat",
          tools: ["read_file", "search_code"],
          systemPrompt:
            "You are a product analyst. Ask the user questions " +
            "to clarify this idea. Produce a structured proposal.",
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
          gate: (ctx) => ctx.hasRunningTask,
          effect: () => ({ transitionTo: "backlog" }),
        },
      ],
    },
    {
      id: "refined",
      label: "Refined",
      description:
        "Idea elaborated. User approves to trigger planning " +
        "with this idea's draft merged into requirements.",
      actions: [
        {
          id: "approve",
          label: "Submit for planning",
          effect: () => ({ transitionTo: "submitted" }),
        },
        {
          id: "reopen",
          label: "Reopen",
          effect: () => ({ transitionTo: "backlog" }),
        },
      ],
    },
    {
      id: "submitted",
      label: "Submitted",
      description:
        "Waiting for planning outcome. When the requirements " +
        "workflow reaches accepted, this idea gets archived.",
    },
    {
      id: "archived",
      label: "Archived",
    },
  ],
  initial: "backlog",
  terminalStates: ["submitted", "archived"],
});
