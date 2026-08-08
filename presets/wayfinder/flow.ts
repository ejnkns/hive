import { defineOperations } from "workflow-engine/runners";
import type {
  ConfigField,
  FlowDefinition,
  FlowEdge,
  RuntimeGateContext,
} from "workflow-engine/workflow-types";
import {
  type BuildItemWorkflowInstanceState,
  type BuildPlan,
  type BuildTaskOutputs,
  type BuildWorkflowInstanceState,
  buildItemWorkflow,
  buildWorkflow,
} from "./build-workflow";
import {
  buildItemOperations,
  buildOperations,
} from "./build-workflow/operations";
import type { ChartingItemState } from "./charting-workflow";
import { chartingWorkflow } from "./charting-workflow";
import { chartingOperations } from "./charting-workflow/operations";
import type { TicketItemState } from "./ticket-workflow";
import { ticketWorkflow } from "./ticket-workflow";
import { ticketOperations } from "./ticket-workflow/operations";
import { wayfinderTools } from "./tools";

// The merged domain operations across all workflows, keyed by the names the
// workflow tasks reference. Each group's state type is bound here — the
// assembly point where the workflows and their operations meet — then erased
// for the shared name-resolved registry. Exported so tests can run them
// directly.
export const wayfinderOperations = {
  ...defineOperations<ChartingItemState>(chartingOperations),
  ...defineOperations<TicketItemState>(ticketOperations),
  ...defineOperations<BuildWorkflowInstanceState>(buildOperations),
  ...defineOperations<BuildItemWorkflowInstanceState>(buildItemOperations),
};

// === WAYFINDER FLOW ===
//
// The wayfinder skill's main flow expressed as four interacting workflows.
//
// Charting: names the destination and surfaces the decision frontier.
//    no_session → naming (session) → frontier (write map + session) → charted
//
// Ticket: one decision ticket per instance, claimed by type, resolved to a
//    recorded decision. fog → ready → resolving_<type> → recording → closed,
//    with out_of_scope as the never-graduates terminal.
//
// Build: the implementation phase — spec the collapsed decisions, plan
//    tracer-bullet tickets, quiz the breakdown, then fan out.
//    specing → planned → proposed → finalizing → accepted
//
// Build-item: one build ticket per instance, worker + two-axis review.
//    ready → working → reviewing → accepting → done | unfulfillable
//
// Flow edges:
//    build/accepted → build-item (one instance per planned ticket)

export const wayfinderConfigSchema: ConfigField[] = [
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
];

// A ticket is open while it is not terminal. The frontier is the set of ready
// tickets; map-clear means nothing is left to resolve.
const OPEN_TICKET_STATES = [
  "fog",
  "ready",
  "resolving_research",
  "resolving_prototype",
  "resolving_grilling",
  "resolving_task",
  "resolving_task_hitl",
  "recording",
] as const;

// Start build is available only when the charting has charted the map and the
// frontier is empty: no ticket is fog, ready, resolving, or recording.
function mapIsClear(ctx: RuntimeGateContext): boolean {
  if (ctx.workflowInstancesInState?.("charted").length === 0) return false;
  return OPEN_TICKET_STATES.every(
    (state) => (ctx.workflowInstancesInState?.(state).length ?? 0) === 0
  );
}

export const wayfinderFlow = {
  id: "wayfinder",
  label: "Wayfinder",
  description:
    "Chart a foggy effort into decision tickets, resolve them one at a time, then build.",
  configSchema: wayfinderConfigSchema,
  domainDir: ".wayfinder",
  workflows: [
    chartingWorkflow,
    ticketWorkflow,
    buildWorkflow,
    buildItemWorkflow,
  ],
  tools: wayfinderTools,
  operations: wayfinderOperations,
  actions: [
    {
      id: "add_ticket",
      label: "Add ticket",
      variant: "primary",
      gate: (ctx) =>
        (ctx.workflowInstancesInState?.("charted").length ?? 0) > 0,
      createInstance: {
        workflowId: "ticket",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
          },
          {
            key: "question",
            label: "Question",
            type: "string",
          },
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
      gate: (ctx) =>
        (ctx.workflowInstancesInState?.("charted").length ?? 0) > 0,
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
      gate: mapIsClear,
      createInstance: { workflowId: "build" },
    },
  ],
  edges: [
    {
      fromWorkflow: "build",
      fromStates: ["accepted"],
      toWorkflow: "build-item",
      // Fan out: one build-item instance per planned ticket. The transform runs
      // with the erased runtime output map; the plan task's structured output
      // is the parsed submit_build_plan completion arguments. Typed against
      // BuildItemWorkflowInstanceState so a misspelled or undeclared field
      // fails to compile.
      transform: (source) => {
        const plan = source.plan?.output as BuildPlan | undefined;
        if (plan === undefined || !Array.isArray(plan.tickets)) return [];
        return plan.tickets.map((ticket) => ({
          ticket: {
            title: ticket.title,
            description: ticket.description,
            acceptanceCriteria: ticket.acceptanceCriteria,
          },
          dependsOn: ticket.dependsOn,
        }));
      },
    } satisfies FlowEdge<BuildTaskOutputs, BuildItemWorkflowInstanceState>,
  ],
} satisfies FlowDefinition;
