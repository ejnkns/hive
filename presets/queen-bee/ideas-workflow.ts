import { defineWorkflow } from "workflow-engine/workflow-types";
import { IDEA_ELABORATION_SYSTEM_PROMPT } from "./prompts";

export type IdeasTaskOutputs = {
  elaborate: { ideaBrief: string; elaboratedSpec: string };
};

export type IdeasStateId =
  | "backlog"
  | "elaborating"
  | "refined"
  | "submitted"
  | "archived";

export const ideasWorkflow = defineWorkflow({
  id: "ideas",
  label: "Ideas",
  item: { title: "title" },
  taskOutputs: {
    elaborate: {} as { ideaBrief: string; elaboratedSpec: string },
  },
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
          startOnUserInput: true,
          systemPrompt: IDEA_ELABORATION_SYSTEM_PROMPT,
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
