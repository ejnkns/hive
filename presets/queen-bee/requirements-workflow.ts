/** @public — the requirements workflow module. */
import { defineWorkflow } from "workflow-engine/workflow-types";
import {
  PLANNER_SYSTEM_PROMPT,
  REQUIREMENTS_DRAFT_SYSTEM_PROMPT,
} from "./requirements-workflow/prompts";

export { requirementsOperations } from "./requirements-workflow/operations";

// A card proposed by the planning agent. Dependencies reference other card
// titles; the engine's dependsOnState gates reference card instance ids, so
// the queen-bee flow keeps them as titles at plan time and the worker
// admission wiring resolves them against the created cards.
export type PlanCard = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[];
};

// The planner's structured output (parsed from its submit_plan completion
// tool call). A proposal fans out into cards; feedback sends the user back
// to the requirements session.
export type PlanProposal =
  | { kind: "proposal"; cards: PlanCard[] }
  | { kind: "feedback"; guidance: string };

export type RequirementsTaskOutputs = {
  draft: { content: string; revision: string };
  plan: PlanProposal;
  finalizeRequirements: string;
  commitState: { ok: boolean; revision?: string };
};

export type RequirementsStateId =
  | "no_session"
  | "drafting"
  | "complete"
  | "planning"
  | "planned"
  | "finalizing"
  | "accepted";

export const requirementsWorkflow = defineWorkflow({
  id: "requirements",
  label: "Requirements",
  instance: { title: "Requirements" },
  taskOutputs: {
    draft: {} as { content: string; revision: string },
    plan: {} as PlanProposal,
    finalizeRequirements: {} as string,
    commitState: {} as { ok: boolean; revision?: string },
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
          trigger: "auto",
          role: "ai-chat",
          tools: [
            "list_directory",
            "read_file",
            "search_code",
            "update_requirements_draft",
          ],
          startOnUserInput: true,
          systemPrompt: REQUIREMENTS_DRAFT_SYSTEM_PROMPT,
          completionSignal: "REQUIREMENTS_COMPLETE",
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
          // A requirements document must be recorded before planning: the
          // planner is grounded in it, and finalizing persists it. Prevents
          // reaching planning/finalizing with no requirements.
          gate: (ctx) => {
            const draft = ctx.workflowInstanceState.requirementsDraft;
            return typeof draft === "string" && draft.trim() !== "";
          },
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
          tools: ["read_file", "search_code", "submit_plan"],
          completionTool: "submit_plan",
          // The requirements document is injected into the planner's first
          // message; without it the planner would propose cards ungrounded.
          inputFromInstanceState: "requirementsDraft",
          systemPrompt: PLANNER_SYSTEM_PROMPT,
        },
      ],
      actions: [
        {
          id: "accept_proposal",
          label: "Accept proposal",
          variant: "primary",
          // Not while the planner is running (or a stale proposal from a
          // previous planning pass is sitting in taskOutputs).
          gate: (ctx) =>
            !ctx.hasRunningTask &&
            ctx.taskOutputs.plan?.output.kind === "proposal",
          transitionTo: "planned",
        },
        {
          id: "repair",
          label: "Start repair session",
          variant: "secondary",
          gate: (ctx) =>
            !ctx.hasRunningTask &&
            ctx.taskOutputs.plan?.output.kind === "feedback",
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
          transitionTo: "finalizing",
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
