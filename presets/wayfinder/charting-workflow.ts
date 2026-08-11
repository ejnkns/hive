/** @public — the charting workflow module: sharpen the destination, surface the frontier. */
import { defineWorkflow } from "workflow-engine/workflow-types";
import {
  FRONTIER_SYSTEM_PROMPT,
  NAMING_SYSTEM_PROMPT,
} from "./charting-workflow/prompts.ts";
import type { SessionTranscript } from "./ticket-workflow.ts";

export type ChartingItemState = {
  destination?: string;
  notes?: string;
};

export type ChartingTaskOutputs = {
  nameSession: SessionTranscript;
  settleChart: string;
  frontierSession: SessionTranscript;
};

export type ChartingStateId = "no_session" | "naming" | "frontier" | "charted";

export const chartingWorkflow = defineWorkflow({
  id: "charting",
  label: "Charting",
  description:
    "Name the destination, surface the decision frontier, then chart the map.",
  instance: { title: "Charting" },
  ui: { view: "list" },
  taskOutputs: {
    nameSession: {} as SessionTranscript,
    settleChart: {} as string,
    frontierSession: {} as SessionTranscript,
  },
  workflowInstanceState: {} as ChartingItemState,
  states: [
    {
      id: "no_session",
      label: "No Session",
      category: "initial",
      actions: [
        {
          id: "start_charting",
          label: "Start charting",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "naming",
        },
      ],
    },
    {
      id: "naming",
      label: "Naming",
      category: "active",
      description: "Sharpen the destination and settle standing notes.",
      tasks: [
        {
          id: "nameSession",
          label: "Naming session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code", "submit_map"],
          startOnUserInput: true,
          systemPrompt: NAMING_SYSTEM_PROMPT,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "frontier",
        },
        {
          id: "cancel",
          label: "Cancel",
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "no_session",
        },
      ],
    },
    {
      id: "frontier",
      label: "Frontier",
      category: "active",
      description:
        "Surface open decisions and first steps across the whole space.",
      tasks: [
        {
          id: "settleChart",
          label: "Settle destination and write map",
          trigger: "auto",
          role: "operation",
          operations: ["settle_chart"],
          persist: { path: "map.md" },
          render: { kind: "markdown" },
        },
        {
          id: "frontierSession",
          label: "Frontier session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code"],
          startOnUserInput: true,
          systemPrompt: FRONTIER_SYSTEM_PROMPT,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "charted",
        },
        {
          id: "cancel",
          label: "Cancel",
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "naming",
        },
      ],
    },
    {
      id: "charted",
      label: "Charted",
      category: "terminal",
      description:
        "The map is charted. Add tickets, graduate fog, resolve the frontier, then Start build.",
    },
  ],
  initial: "no_session",
  terminalStates: ["charted"],
});
