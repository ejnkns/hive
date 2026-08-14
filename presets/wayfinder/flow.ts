import { defineTool } from "workflow-engine/runners";
import {
  type CompiledFlowDefinition,
  defineWorkflow,
  type FlowEdge,
} from "workflow-engine/workflow-types";
import { finalize_specOperations } from "./build/ops/finalize-spec.ts";
import { merge_build_workOperations } from "./build/ops/merge-build-work.ts";
import { persist_build_planOperations } from "./build/ops/persist-build-plan.ts";
import { prepare_build_workspaceOperations } from "./build/ops/prepare-build-workspace.ts";
import { planner } from "./build/prompts/planner.ts";
import { reviewer } from "./build/prompts/reviewer.ts";
import { specing } from "./build/prompts/specing.ts";
import { worker } from "./build/prompts/worker.ts";
import { settle_chartOperations } from "./charting/ops/settle-chart.ts";
import { frontier } from "./charting/prompts/frontier.ts";
import { naming } from "./charting/prompts/naming.ts";
import { blockersClosed } from "./gates/blockers-closed.ts";
import { frontierCharted } from "./gates/frontier-charted.ts";
import { mapIsClear } from "./gates/map-is-clear.ts";
import { specRecorded } from "./gates/spec-recorded.ts";
import { assemble_resolutionOperations } from "./ticket/ops/assemble-resolution.ts";
import { normalize_ticketOperations } from "./ticket/ops/normalize-ticket.ts";
import { persist_research_findingsOperations } from "./ticket/ops/persist-research-findings.ts";
import { prepare_prototype_workspaceOperations } from "./ticket/ops/prepare-prototype-workspace.ts";
import { grilling } from "./ticket/prompts/grilling.ts";
import { prototype } from "./ticket/prompts/prototype.ts";
import { research } from "./ticket/prompts/research.ts";
import { taskAfk } from "./ticket/prompts/task-afk.ts";
import { taskHitl } from "./ticket/prompts/task-hitl.ts";
import { submit_mapTools } from "./tools/submit-map.ts";
import { submit_specTools } from "./tools/submit-spec.ts";

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

type ChartingItemState = {
  destination?: string;
  notes?: string;
};

type ChartingTaskOutputs = {
  nameSession?: Record<string, never>;
  settleChart?: Record<string, never>;
  frontierSession?: Record<string, never>;
};

const chartingWf = defineWorkflow({
  id: "charting",
  label: "Charting",
  description:
    "Name the destination, surface the decision frontier, then chart the map.",
  ui: { view: "list" },
  taskOutputs: {} as ChartingTaskOutputs,
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
      description: "Sharpen the destination and settle standing notes.",
      category: "active",
      tasks: [
        {
          id: "nameSession",
          label: "Naming session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code", "submit_map"],
          systemPrompt: naming,
          startOnUserInput: true,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
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
      description:
        "Surface open decisions and first steps across the whole space.",
      category: "active",
      tasks: [
        {
          id: "settleChart",
          label: "Settle destination and write map",
          trigger: "auto",
          role: "operation",
          operations: ["settle_chart"],
          persist: { path: "map.md" },
        },
        {
          id: "frontierSession",
          label: "Frontier session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code"],
          systemPrompt: frontier,
          startOnUserInput: true,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
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
      description:
        "The map is charted. Add tickets, graduate fog, resolve the frontier, then Start build.",
      category: "terminal",
    },
  ],
  initial: "no_session",
  terminalStates: ["charted"],
});

type TicketItemState = {
  title?: string;
  question?: string;
  type?: string;
  dependsOn?: string[];
  brief?: string;
  hitl?: boolean;
  worktreePath?: string;
  branchName?: string;
};

type TicketTaskOutputs = {
  normalizeTicket?: Record<string, never>;
  research?: { question?: string; findings?: string; sources?: string[] };
  persistFindings?: Record<string, never>;
  preparePrototype?: Record<string, never>;
  prototypeSession?: {
    content?: string;
    completion?: { decision?: string; gist?: string; artifactPath?: string };
  };
  grillSession?: {
    content?: string;
    completion?: { decision?: string; gist?: string };
  };
  taskSession?: { decision?: string; gist?: string };
  taskHitlSession?: {
    content?: string;
    completion?: { decision?: string; gist?: string };
  };
  assembleResolution?: Record<string, never>;
};

export const ticketCompletionTools = [
  defineTool({
    name: "ticket_research_complete",
    description:
      "Complete the Run research task, returning the declared fields: question (string), findings (string), sources (string[]).",
    parameters: {
      properties: {
        question: { type: "string", description: "The ticket question." },
        findings: {
          type: "string",
          description: "The full cited research report in markdown.",
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Primary-source URLs consulted.",
        },
      },
      required: ["question", "findings", "sources"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "ticket_prototypeSession_complete",
    description:
      "Complete the Prototype session task, returning the declared fields: decision (string), gist (string), artifactPath (string).",
    parameters: {
      properties: {
        decision: {
          type: "string",
          description: "The captured answer to the design question.",
        },
        gist: { type: "string", description: "The one-line takeaway." },
        artifactPath: {
          type: "string",
          description:
            "Relative path of the throwaway artifact kept as a primary source.",
        },
      },
      required: ["decision", "gist", "artifactPath"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "ticket_grillSession_complete",
    description:
      "Complete the Grilling session task, returning the declared fields: decision (string), gist (string).",
    parameters: {
      properties: {
        decision: {
          type: "string",
          description: "The sharp decision reached.",
        },
        gist: {
          type: "string",
          description:
            "A one-to-two sentence summary of the shared understanding.",
        },
      },
      required: ["decision", "gist"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "ticket_taskSession_complete",
    description:
      "Complete the Run task task, returning the declared fields: decision (string), gist (string).",
    parameters: {
      properties: {
        decision: {
          type: "string",
          description: "What was done, or the blocker if it could not proceed.",
        },
        gist: { type: "string", description: "The verification that was run." },
      },
      required: ["decision", "gist"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "ticket_taskHitlSession_complete",
    description:
      "Complete the Task session task, returning the declared fields: decision (string), gist (string).",
    parameters: {
      properties: {
        decision: { type: "string", description: "The outcome of the task." },
        gist: {
          type: "string",
          description: "A short record of what the human carried out.",
        },
      },
      required: ["decision", "gist"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
];

const ticketWf = defineWorkflow({
  id: "ticket",
  label: "Ticket",
  description:
    "A decision ticket: graduated from fog, claimed by type, resolved to a recorded decision.",
  instance: { title: "title" },
  ui: {
    view: "board",
    columns: [
      { id: "fog", label: "Fog", states: ["fog"] },
      { id: "frontier", label: "Frontier", states: ["ready"] },
      {
        id: "resolving",
        label: "Resolving",
        states: [
          "resolving_research",
          "resolving_prototype",
          "resolving_grilling",
          "resolving_task",
          "resolving_task_hitl",
          "recording",
        ],
      },
      { id: "closed", label: "Closed", states: ["closed", "out_of_scope"] },
    ],
  },
  display: {
    fields: [
      { path: "title", label: "Title" },
      { path: "question", label: "Question" },
      { path: "type", label: "Type" },
      { path: "dependsOn", label: "Blocks on" },
    ],
  },
  taskOutputs: {} as TicketTaskOutputs,
  workflowInstanceState: {} as TicketItemState,
  states: [
    {
      id: "fog",
      label: "Fog",
      description: "Not yet specified — the question is still foggy.",
      category: "initial",
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
      description: "Claimable — the frontier.",
      category: "active",
      actions: [
        {
          id: "claim_research",
          label: "Claim for research",
          variant: "primary",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "research" &&
            blockersClosed(ctx),
          dependsOnState: "closed",
          transitionTo: "resolving_research",
        },
        {
          id: "claim_prototype",
          label: "Claim for prototype",
          variant: "primary",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "prototype" &&
            blockersClosed(ctx),
          dependsOnState: "closed",
          transitionTo: "resolving_prototype",
        },
        {
          id: "claim_grilling",
          label: "Claim for grilling",
          variant: "primary",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "grilling" &&
            blockersClosed(ctx),
          dependsOnState: "closed",
          transitionTo: "resolving_grilling",
        },
        {
          id: "claim_task",
          label: "Claim as task",
          variant: "primary",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "task" &&
            !(ctx.workflowInstanceState.hitl === true) &&
            blockersClosed(ctx),
          dependsOnState: "closed",
          transitionTo: "resolving_task",
        },
        {
          id: "claim_task_hitl",
          label: "Claim as task (session)",
          variant: "primary",
          gate: (ctx) =>
            ctx.workflowInstanceState.type === "task" &&
            ctx.workflowInstanceState.hitl === true &&
            blockersClosed(ctx),
          dependsOnState: "closed",
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
            "ticket_research_complete",
          ],
          completionTool: "ticket_research_complete",
          systemPrompt: research,
        },
        {
          id: "persistFindings",
          label: "Persist research findings",
          trigger: "auto",
          role: "operation",
          operations: ["persist_research_findings"],
          persist: { path: "research/{instanceId}.md" },
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
          tools: [
            "read_file",
            "write_file",
            "run_command",
            "list_directory",
            "ticket_prototypeSession_complete",
          ],
          completionTool: "ticket_prototypeSession_complete",
          systemPrompt: prototype,
          startOnUserInput: true,
          workspacePath: "@instance:worktreePath",
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
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
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
            "ticket_grillSession_complete",
          ],
          completionTool: "ticket_grillSession_complete",
          systemPrompt: grilling,
          startOnUserInput: true,
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
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
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
            "ticket_taskSession_complete",
          ],
          completionTool: "ticket_taskSession_complete",
          systemPrompt: taskAfk,
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
            "ticket_taskHitlSession_complete",
          ],
          completionTool: "ticket_taskHitlSession_complete",
          systemPrompt: taskHitl,
          startOnUserInput: true,
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
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
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
      description: "A Decisions-so-far entry.",
      category: "terminal",
    },
    {
      id: "out_of_scope",
      label: "Out of scope",
      description: "Closed — never graduates.",
      category: "terminal",
    },
  ],
  initial: "fog",
  terminalStates: ["closed", "out_of_scope"],
});

type BuildItemState = {
  spec?: string;
};

type BuildTaskOutputs = {
  specSession?: Record<string, never>;
  finalizeSpec?: Record<string, never>;
  plan?: { tickets?: Array<Record<string, unknown>> };
  persistPlan?: Record<string, never>;
};

export const buildCompletionTools = [
  defineTool({
    name: "build_plan_complete",
    description:
      "Complete the Run planner task, returning the declared fields: tickets (object[]).",
    parameters: {
      properties: {
        tickets: {
          type: "array",
          items: { type: "object" },
          description:
            "One entry per tracer-bullet build ticket: { title, description, acceptanceCriteria, dependsOn }.",
        },
      },
      required: ["tickets"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
];

const buildWf = defineWorkflow({
  id: "build",
  label: "Build",
  description:
    "The implementation phase: spec the collapsed decisions, plan tracer-bullet tickets, quiz the breakdown, then fan out build items.",
  ui: { view: "list" },
  taskOutputs: {} as BuildTaskOutputs,
  workflowInstanceState: {} as BuildItemState,
  states: [
    {
      id: "specing",
      label: "Specing",
      description:
        "Synthesize the decision records into a spec and check the seams with the human.",
      category: "initial",
      tasks: [
        {
          id: "specSession",
          label: "Spec session",
          trigger: "auto",
          role: "ai-chat",
          tools: ["list_directory", "read_file", "search_code", "submit_spec"],
          systemPrompt: specing,
          startOnUserInput: true,
        },
      ],
      actions: [
        {
          id: "done",
          label: "Done",
          variant: "primary",
          gate: (ctx) => ctx.hasRunningTask && specRecorded(ctx),
          completesRunningTask: true,
          transitionTo: "planned",
        },
        {
          id: "restart",
          label: "Restart session",
          variant: "secondary",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "specing",
        },
      ],
    },
    {
      id: "planned",
      label: "Planned",
      category: "active",
      tasks: [
        {
          id: "finalizeSpec",
          label: "Write spec document",
          trigger: "auto",
          role: "operation",
          operations: ["finalize_spec"],
          persist: { path: "spec.md" },
        },
        {
          id: "plan",
          label: "Run planner",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code", "build_plan_complete"],
          completionTool: "build_plan_complete",
          systemPrompt: planner,
          inputFromInstanceState: "spec",
        },
      ],
      autoTransitions: [
        {
          to: "proposed",
          gate: (ctx) =>
            ctx.taskOutputs.finalizeSpec?.status === "success" &&
            ctx.taskOutputs.plan?.status === "success",
        },
      ],
    },
    {
      id: "proposed",
      label: "Proposed",
      description:
        "The draft build plan — quiz the breakdown before the fan-out.",
      category: "active",
      actions: [
        {
          id: "accept_proposal",
          label: "Accept and create build items",
          variant: "primary",
          gate: (ctx) =>
            !ctx.hasRunningTask && ctx.taskOutputs.plan?.status === "success",
          transitionTo: "finalizing",
        },
        {
          id: "request_revision",
          label: "Request revision",
          variant: "secondary",
          gate: (ctx) =>
            !ctx.hasRunningTask && ctx.taskOutputs.plan?.status === "success",
          transitionTo: "specing",
        },
      ],
    },
    {
      id: "finalizing",
      label: "Finalizing",
      category: "active",
      tasks: [
        {
          id: "persistPlan",
          label: "Persist build plan",
          trigger: "auto",
          role: "operation",
          operations: ["persist_build_plan"],
          persist: { path: "build-plan.md" },
        },
      ],
      autoTransitions: [
        {
          to: "accepted",
          gate: (ctx) => ctx.taskOutputs.persistPlan?.status === "success",
        },
      ],
    },
    {
      id: "accepted",
      label: "Accepted",
      description: "The plan is accepted; build items fan out.",
      category: "terminal",
    },
  ],
  initial: "specing",
  terminalStates: ["accepted"],
});

type BuildItemItemState = {
  ticket?: Record<string, unknown>;
  dependsOn?: string[];
  worktreePath?: string;
  branchName?: string;
};

type BuildItemTaskOutputs = {
  prepareWorkspace?: Record<string, never>;
  runAgent?: {
    content?: string;
    completion?: { outcome?: string; summary?: string };
  };
  review?: { verdict?: string; findings?: Array<Record<string, unknown>> };
  mergeWork?: Record<string, never>;
};

export const buildItemCompletionTools = [
  defineTool({
    name: "buildItem_runAgent_complete",
    description:
      "Complete the Run build worker task, returning the declared fields: outcome (string), summary (string).",
    parameters: {
      properties: {
        outcome: { type: "string", description: '"implemented" or "blocked".' },
        summary: {
          type: "string",
          description:
            "What was done and how it was verified, or the precise blocker.",
        },
      },
      required: ["outcome", "summary"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
  defineTool({
    name: "buildItem_review_complete",
    description:
      "Complete the Run code review task, returning the declared fields: verdict (string), findings (object[]).",
    parameters: {
      properties: {
        verdict: {
          type: "string",
          description: '"approved" or "changes_requested".',
        },
        findings: {
          type: "array",
          items: { type: "object" },
          description: "Each finding: axis, severity, detail, and evidence.",
        },
      },
      required: ["verdict", "findings"],
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  }),
];

const buildItemWf = defineWorkflow({
  id: "buildItem",
  label: "Build Item",
  description:
    "One build ticket: worker implements in an isolated workspace, reviewer audits on two axes.",
  instance: { title: "ticket.title" },
  ui: { view: "board" },
  display: {
    fields: [
      {
        path: "ticket",
        label: "Build ticket",
        render: {
          kind: "card",
          props: {
            title: "title",
            description: "description",
            bullets: "acceptanceCriteria",
          },
        },
      },
    ],
  },
  taskOutputs: {} as BuildItemTaskOutputs,
  workflowInstanceState: {} as BuildItemItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "run",
          label: "Run build item",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          maxWorkflowInstancesInTarget: 3,
          dependsOnState: "done",
          transitionTo: "working",
        },
      ],
    },
    {
      id: "working",
      label: "Working",
      category: "active",
      tasks: [
        {
          id: "prepareWorkspace",
          label: "Prepare workspace",
          trigger: "auto",
          role: "operation",
          operations: ["prepare_build_workspace"],
        },
      ],
      autoTransitions: [
        {
          to: "unfulfillable",
          gate: (ctx) => ctx.taskOutputs.prepareWorkspace?.status === "error",
        },
        {
          to: "running",
          gate: (ctx) => ctx.taskOutputs.prepareWorkspace?.status === "success",
        },
      ],
    },
    {
      id: "running",
      label: "Running",
      category: "active",
      tasks: [
        {
          id: "runAgent",
          label: "Run build worker",
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
            "buildItem_runAgent_complete",
          ],
          completionTool: "buildItem_runAgent_complete",
          systemPrompt: worker,
          workspacePath: "@instance:worktreePath",
          inputFromInstanceState: "ticket",
        },
      ],
      autoTransitions: [
        {
          to: "unfulfillable",
          gate: (ctx) =>
            ctx.taskOutputs.runAgent?.output?.completion?.outcome === "blocked",
        },
        {
          to: "reviewing",
          gate: (ctx) =>
            ctx.taskOutputs.runAgent?.output?.completion?.outcome ===
            "implemented",
        },
      ],
      actions: [
        {
          id: "retry",
          label: "Retry worker",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.runAgent?.status === "error",
          transitionTo: "running",
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
          label: "Run code review",
          trigger: "auto",
          role: "ai-task",
          tools: [
            "read_file",
            "list_directory",
            "search_code",
            "git_diff",
            "git_log",
            "git_show",
            "buildItem_review_complete",
          ],
          completionTool: "buildItem_review_complete",
          systemPrompt: reviewer,
          workspacePath: "@instance:worktreePath",
        },
      ],
      autoTransitions: [
        {
          to: "accepting",
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
        },
        {
          to: "working",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
        },
      ],
      actions: [
        {
          id: "retry_review",
          label: "Retry review",
          variant: "secondary",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
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
          label: "Merge accepted work",
          trigger: "auto",
          role: "operation",
          operations: ["merge_build_work"],
        },
      ],
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.mergeWork?.status === "success",
        },
        {
          to: "reviewing",
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
      actions: [
        {
          id: "retry",
          label: "Retry build item",
          variant: "primary",
          transitionTo: "working",
        },
        {
          id: "archive",
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

export const flow = {
  id: "wayfinder",
  label: "Wayfinder",
  description:
    "Chart a foggy effort into decision tickets, resolve them one at a time, then build.",
  configSchema: [
    {
      key: "destination",
      label: "Destination",
      type: "string",
      hint: "The effort's destination, stated at creation; sharpened by the charting session.",
    },
    {
      key: "notes",
      label: "Notes",
      type: "string",
      hint: "Domain, standing preferences, and whether execution is carried into the map.",
    },
    {
      key: "basePath",
      label: "Base path",
      type: "string",
      hint: "The destination directory (a repo or scratch dir). Optional for planning-only; required for the build phase to persist and read the decision records.",
    },
  ],
  domainDir: ".wayfinder",
  workflows: [chartingWf, ticketWf, buildWf, buildItemWf],
  operations: {
    ...settle_chartOperations,
    ...normalize_ticketOperations,
    ...prepare_prototype_workspaceOperations,
    ...assemble_resolutionOperations,
    ...persist_research_findingsOperations,
    ...finalize_specOperations,
    ...persist_build_planOperations,
    ...prepare_build_workspaceOperations,
    ...merge_build_workOperations,
  },
  tools: [
    ...submit_mapTools,
    ...submit_specTools,
    ...ticketCompletionTools,
    ...buildCompletionTools,
    ...buildItemCompletionTools,
  ],
  actions: [
    {
      id: "add_ticket",
      label: "Add ticket",
      variant: "primary",
      gate: (ctx) => frontierCharted(ctx),
      createInstance: {
        workflowId: "ticket",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "question", label: "Question", type: "string" },
          {
            key: "type",
            label: "Type",
            type: "string",
            required: true,
            hint: "How the ticket resolves: research (AFK), prototype, grilling, or task.",
            options: ["research", "prototype", "grilling", "task"],
          },
          {
            key: "dependsOn",
            label: "Blocks on",
            type: "string",
            hint: "Comma-separated ticket ids",
          },
          {
            key: "hitl",
            label: "HITL session (task tickets)",
            type: "boolean",
            hint: "Resolve a task ticket through a live session instead of an AFK run.",
          },
        ],
      },
    },
    {
      id: "add_fog_entry",
      label: "Add fog entry",
      variant: "secondary",
      gate: (ctx) => frontierCharted(ctx),
      createInstance: {
        workflowId: "ticket",
        fields: [
          {
            key: "brief",
            label: "Brief",
            type: "string",
            required: true,
            hint: "A vague statement to be sharpened or ruled out.",
          },
        ],
      },
    },
    {
      id: "start_build",
      label: "Start build",
      variant: "primary",
      gate: (ctx) => mapIsClear(ctx),
      createInstance: { workflowId: "build", fields: [] },
    },
  ],
  edges: [
    {
      fromWorkflow: "build",
      fromStates: ["accepted"],
      toWorkflow: "buildItem",
      transform: (source) => {
        const items =
          (readPath(source.plan, "output.tickets") as
            | Array<Record<string, unknown>>
            | undefined) ?? [];
        return items.map((item) => ({
          ticket: item as Record<string, unknown> | undefined,
          dependsOn: readPath(item, "dependsOn") as string[] | undefined,
        }));
      },
    } satisfies FlowEdge,
  ],
} satisfies CompiledFlowDefinition;
