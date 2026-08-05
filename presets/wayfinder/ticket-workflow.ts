/** @public — the decision-ticket workflow module. One instance = one decision ticket. */

import type { ChatMessage } from "workflow-engine/workflow-types";
import { defineWorkflow } from "workflow-engine/workflow-types";
import {
  GRILLING_RESOLUTION_SYSTEM_PROMPT,
  PROTOTYPE_RESOLUTION_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  TASK_AFK_SYSTEM_PROMPT,
  TASK_HITL_SYSTEM_PROMPT,
} from "./ticket-workflow/prompts";

export { ticketOperations } from "./ticket-workflow/operations";

export type TicketType = "research" | "prototype" | "grilling" | "task";

// The domain data a ticket instance carries. dependsOn references other ticket
// instance ids (the flow's create-then-wire blocking edges); normalize_ticket
// normalizes a comma-separated form string into the array the engine's
// dependsOnState backstop reads.
export type TicketItemState = {
  title: string;
  question: string;
  type: TicketType;
  dependsOn: string[];
  // Creation-time input from the Add fog entry form; normalized into
  // title/question by normalize_ticket and not part of the settled shape.
  brief?: string;
  // Whether a task-type ticket runs as a live ai-chat session (true) or an
  // AFK one-shot ai-task (false/absent).
  hitl?: boolean;
  worktreePath?: string;
  branchName?: string;
};

// The parsed arguments of a submit_resolution completion call. When a session
// ends via the human's Done action instead, the output is the transcript.
export type ResolutionOutput = {
  decision: string;
  gist: string;
  artifactPath?: string;
};

export type SessionTranscript = {
  content: string;
  messages: ChatMessage[];
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

export type TicketTaskOutputs = {
  normalizeTicket: { ok: boolean; type: TicketType; dependsOn: string[] };
  research: { question: string; findings: string; sources: string[] };
  persistFindings: string;
  preparePrototype: { ok: boolean; path?: string; branchName?: string };
  prototypeSession: ResolutionOutput | SessionTranscript;
  grillSession: ResolutionOutput | SessionTranscript;
  taskSession: ResolutionOutput | SessionTranscript;
  taskHitlSession: ResolutionOutput | SessionTranscript;
  assembleResolution: string;
};

export type TicketStateId =
  | "fog"
  | "ready"
  | "resolving_research"
  | "resolving_prototype"
  | "resolving_grilling"
  | "resolving_task"
  | "resolving_task_hitl"
  | "recording"
  | "closed"
  | "out_of_scope";

// The resolving task ids whose outputs can carry a resolution (either a
// submit_resolution completion or a Done-ended transcript).
export const RESOLUTION_TASK_IDS = [
  "prototypeSession",
  "grillSession",
  "taskSession",
  "taskHitlSession",
] as const;

// The frontier check: a claim action is visible only when every dependsOn
// blocker is closed. The engine's dependsOnState backstop re-checks at dispatch.
export function blockersClosed(ctx: {
  workflowInstanceState: Partial<TicketItemState>;
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[];
}): boolean {
  const dependsOn = ctx.workflowInstanceState.dependsOn ?? [];
  if (dependsOn.length === 0) return true;
  const closedIds = new Set(
    (ctx.workflowInstancesInState?.("closed") ?? []).map(
      (instance) => instance.id
    )
  );
  return dependsOn.every((id) => closedIds.has(id));
}

export const ticketWorkflow = defineWorkflow({
  id: "ticket",
  label: "Ticket",
  description:
    "A decision ticket: graduated from fog, claimed by type, resolved to a recorded decision.",
  instance: { title: "title" },
  display: {
    fields: [
      { path: "title", label: "Title" },
      { path: "question", label: "Question" },
      { path: "type", label: "Type" },
      { path: "dependsOn", label: "Blocks on" },
    ],
  },
  taskOutputs: {
    normalizeTicket: {} as {
      ok: boolean;
      type: TicketType;
      dependsOn: string[];
    },
    research: {} as { question: string; findings: string; sources: string[] },
    persistFindings: {} as string,
    preparePrototype: {} as { ok: boolean; path?: string; branchName?: string },
    prototypeSession: {} as ResolutionOutput | SessionTranscript,
    grillSession: {} as ResolutionOutput | SessionTranscript,
    taskSession: {} as ResolutionOutput | SessionTranscript,
    taskHitlSession: {} as ResolutionOutput | SessionTranscript,
    assembleResolution: {} as string,
  },
  workflowInstanceState: {} as TicketItemState,
  states: [
    {
      id: "fog",
      label: "Fog",
      category: "initial",
      description: "Not yet specified — the question is still foggy.",
      tasks: [
        {
          id: "normalizeTicket",
          label: "Normalize ticket",
          trigger: "auto",
          role: "operation",
          operations: ["normalize_ticket"],
        },
      ],
      actions: [
        {
          id: "graduate",
          label: "Graduate to ready",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "ready",
        },
        {
          id: "rule_out",
          label: "Rule out of scope",
          variant: "destructive",
          transitionTo: "out_of_scope",
        },
      ],
    },
    {
      id: "ready",
      label: "Ready",
      category: "active",
      description: "Claimable — the frontier.",
      actions: [
        {
          id: "claim_research",
          label: "Claim for research",
          variant: "primary",
          dependsOnState: "closed",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "research" &&
            blockersClosed(ctx),
          transitionTo: "resolving_research",
        },
        {
          id: "claim_prototype",
          label: "Claim for prototype",
          variant: "primary",
          dependsOnState: "closed",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "prototype" &&
            blockersClosed(ctx),
          transitionTo: "resolving_prototype",
        },
        {
          id: "claim_grilling",
          label: "Claim for grilling",
          variant: "primary",
          dependsOnState: "closed",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "grilling" &&
            blockersClosed(ctx),
          transitionTo: "resolving_grilling",
        },
        {
          id: "claim_task",
          label: "Claim as task",
          variant: "primary",
          dependsOnState: "closed",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "task" &&
            ctx.workflowInstanceState.hitl !== true &&
            blockersClosed(ctx),
          transitionTo: "resolving_task",
        },
        {
          id: "claim_task_hitl",
          label: "Claim as task (session)",
          variant: "primary",
          dependsOnState: "closed",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "task" &&
            ctx.workflowInstanceState.hitl === true &&
            blockersClosed(ctx),
          transitionTo: "resolving_task_hitl",
        },
        {
          id: "rule_out",
          label: "Rule out of scope",
          variant: "destructive",
          transitionTo: "out_of_scope",
        },
      ],
    },
    {
      id: "resolving_research",
      label: "Resolving — research",
      category: "active",
      tasks: [
        {
          id: "research",
          label: "Run research",
          trigger: "auto",
          role: "ai-task",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "submit_findings",
          ],
          completionTool: "submit_findings",
          systemPrompt: RESEARCH_SYSTEM_PROMPT,
          render: { kind: "markdown", props: { content: "findings" } },
        },
        {
          id: "persistFindings",
          label: "Persist research findings",
          trigger: "auto",
          role: "operation",
          operations: ["persist_research_findings"],
          persist: { path: "research/{instanceId}.md" },
          render: { kind: "markdown" },
        },
      ],
      autoTransitions: [
        {
          to: "recording",
          gate: (ctx) =>
            ctx.taskOutputs.research?.status === "success" &&
            ctx.taskOutputs.persistFindings?.status === "success",
        },
      ],
      actions: [
        {
          id: "retry",
          label: "Retry research",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.research?.status === "error",
          transitionTo: "resolving_research",
        },
        {
          id: "cancel",
          label: "Cancel",
          variant: "secondary",
          transitionTo: "ready",
        },
      ],
    },
    {
      id: "resolving_prototype",
      label: "Resolving — prototype",
      category: "active",
      tasks: [
        {
          id: "preparePrototype",
          label: "Prepare prototype workspace",
          trigger: "auto",
          role: "operation",
          operations: ["prepare_prototype_workspace"],
        },
        {
          id: "prototypeSession",
          label: "Prototype session",
          trigger: "auto",
          role: "ai-chat",
          workspacePath: "@instance:worktreePath",
          tools: [
            "read_file",
            "write_file",
            "run_command",
            "list_directory",
            "submit_resolution",
          ],
          startOnUserInput: true,
          systemPrompt: PROTOTYPE_RESOLUTION_SYSTEM_PROMPT,
        },
      ],
      autoTransitions: [
        {
          to: "recording",
          gate: (ctx) =>
            ctx.taskOutputs.preparePrototype?.status === "success" &&
            ctx.taskOutputs.prototypeSession?.status === "success",
        },
        {
          to: "ready",
          gate: (ctx) => ctx.taskOutputs.preparePrototype?.status === "error",
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "recording",
        },
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
      id: "resolving_grilling",
      label: "Resolving — grilling",
      category: "active",
      tasks: [
        {
          id: "grillSession",
          label: "Grilling session",
          trigger: "auto",
          role: "ai-chat",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "create_instance",
            "submit_resolution",
          ],
          startOnUserInput: true,
          systemPrompt: GRILLING_RESOLUTION_SYSTEM_PROMPT,
        },
      ],
      autoTransitions: [
        {
          to: "recording",
          gate: (ctx) => ctx.taskOutputs.grillSession?.status === "success",
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "recording",
        },
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
      id: "resolving_task",
      label: "Resolving — task",
      category: "active",
      tasks: [
        {
          id: "taskSession",
          label: "Run task",
          trigger: "auto",
          role: "ai-task",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "run_command",
            "write_file",
            "submit_resolution",
          ],
          completionTool: "submit_resolution",
          systemPrompt: TASK_AFK_SYSTEM_PROMPT,
        },
      ],
      autoTransitions: [
        {
          to: "recording",
          gate: (ctx) => ctx.taskOutputs.taskSession?.status === "success",
        },
      ],
      actions: [
        {
          id: "retry",
          label: "Retry task",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.taskSession?.status === "error",
          transitionTo: "resolving_task",
        },
        {
          id: "cancel",
          label: "Cancel",
          variant: "secondary",
          transitionTo: "ready",
        },
      ],
    },
    {
      id: "resolving_task_hitl",
      label: "Resolving — task session",
      category: "active",
      tasks: [
        {
          id: "taskHitlSession",
          label: "Task session",
          trigger: "auto",
          role: "ai-chat",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "run_command",
            "submit_resolution",
          ],
          startOnUserInput: true,
          systemPrompt: TASK_HITL_SYSTEM_PROMPT,
        },
      ],
      autoTransitions: [
        {
          to: "recording",
          gate: (ctx) => ctx.taskOutputs.taskHitlSession?.status === "success",
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          completesRunningTask: true,
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "recording",
        },
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
      id: "recording",
      label: "Recording",
      category: "active",
      tasks: [
        {
          id: "assembleResolution",
          label: "Assemble decision record",
          trigger: "auto",
          role: "operation",
          operations: ["assemble_resolution"],
          persist: { path: "decisions/{instanceId}.md" },
          render: { kind: "markdown" },
        },
      ],
      autoTransitions: [
        {
          to: "closed",
          gate: (ctx) =>
            ctx.taskOutputs.assembleResolution?.status === "success",
        },
        {
          to: "ready",
          gate: (ctx) => ctx.taskOutputs.assembleResolution?.status === "error",
        },
      ],
    },
    {
      id: "closed",
      label: "Closed",
      category: "terminal",
      description: "A Decisions-so-far entry.",
    },
    {
      id: "out_of_scope",
      label: "Out of scope",
      category: "terminal",
      description: "Closed — never graduates.",
    },
  ],
  initial: "fog",
  terminalStates: ["closed", "out_of_scope"],
});
