/** The visual-matrix fixture builders: fixed-id FlowViewProps /
 * InstanceComponentProps for the served wayfinder surfaces. Stories own the
 * fixture id space — every id is a string literal, never crypto.randomUUID —
 * so the map layout PRNG (seeded from the sorted node/edge ids) and therefore
 * the constellation are stable across builds. The lifecycle fixtures reuse
 * the ui package's wayfinder-fixtures (the same deterministic baseline the
 * component tests pin); shape variants live in story-shapes.ts. */

import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import { WAYFINDER_DECISION_RECORDS } from "ui/flow-rendering/components/wayfinder-fixtures";
import { cardDef, entry } from "ui/flow-rendering/test-fixtures";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  FlowViewProps,
  InstanceComponentProps,
  VisibleAction,
} from "workflow-engine/workflow-types";

// A definition state with no server-side actions/tasks (the visual stories
// drive affordances from the entry's availableActions, not the definition).
type WfState = WorkflowDefResponse["states"][number];

function state(
  id: string,
  label: string,
  category?: WfState["category"]
): WfState {
  return { id, label, category, actions: [] };
}

// The wayfinder workflow definitions: real state ids and labels, trimmed to
// the states the fixtures present.
function chartingDef(): WorkflowDefResponse {
  return cardDef({
    id: "charting",
    label: "Charting",
    instance: { title: "destination" },
    states: [
      state("no_session", "No Session", "initial"),
      state("naming", "Naming", "active"),
      state("frontier", "Frontier", "active"),
      state("charted", "Charted", "terminal"),
    ],
    initial: "no_session",
    terminalStates: ["charted"],
  });
}

function ticketDef(): WorkflowDefResponse {
  return cardDef({
    id: "ticket",
    label: "Ticket",
    instance: { title: "title" },
    ui: {
      view: "board",
      instanceComponent: "ticket-card",
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
        { id: "closed", label: "Closed", states: ["closed"] },
        { id: "out_of_scope", label: "Out of scope", states: ["out_of_scope"] },
      ],
    },
    states: [
      state("fog", "Fog", "initial"),
      state("ready", "Ready", "active"),
      state("resolving_research", "Resolving - research", "active"),
      state("resolving_prototype", "Resolving - prototype", "active"),
      state("resolving_grilling", "Resolving - grilling", "active"),
      state("resolving_task", "Resolving - task", "active"),
      state("resolving_task_hitl", "Resolving - task session", "active"),
      state("recording", "Recording", "active"),
      state("closed", "Closed", "terminal"),
      state("out_of_scope", "Out of scope", "terminal"),
    ],
    initial: "fog",
    terminalStates: ["closed", "out_of_scope"],
  });
}

function buildDef(): WorkflowDefResponse {
  return cardDef({
    id: "build",
    label: "Build",
    instance: { title: "spec" },
    states: [
      state("specing", "Specing", "initial"),
      state("planned", "Planned", "active"),
      state("proposed", "Proposed", "active"),
      state("finalizing", "Finalizing", "active"),
      state("accepted", "Accepted", "terminal"),
    ],
    initial: "specing",
    terminalStates: ["accepted"],
  });
}

function buildItemDef(): WorkflowDefResponse {
  return cardDef({
    id: "buildItem",
    label: "Build Item",
    instance: { title: "ticket.title" },
    ui: { view: "board" },
    states: [
      state("ready", "Ready", "initial"),
      state("working", "Working", "active"),
      state("running", "Running", "active"),
      state("review", "Review", "active"),
      state("merged", "Merged", "terminal"),
    ],
    initial: "ready",
    terminalStates: ["merged"],
  });
}

export function wayfinderDefs(): WorkflowDefResponse[] {
  return [chartingDef(), ticketDef(), buildDef(), buildItemDef()];
}

/** One wayfinder definition by workflow id (throws on a fixture typo — the
 * story itself is the failure site, not a silently undefined card). */
export function wayfinderDef(id: string): WorkflowDefResponse {
  const def = wayfinderDefs().find((candidate) => candidate.id === id);
  if (def === undefined) throw new Error(`definition "${id}" missing`);
  return def;
}

// A flow-level action for the HUD / table header (the flow surface renders
// these data-driven like the served host does).
export const wayfinderFlowActions: FlowViewProps["availableFlowActions"] = [
  {
    id: "chart-expedition",
    label: "Chart expedition",
    variant: "primary",
    createInstance: { workflowId: "charting", fields: [] },
  },
];

// A WorkflowItem-level action set (the claim affordances the table cards
// render; the map view renders no per-item actions).
export const claimAction: VisibleAction = {
  id: "claim_research",
  label: "Claim research",
  variant: "primary",
};

// A flow-level props (the flow-component surface) ──────────────────────────

export type FlowSurfaceOptions = {
  /** The story-unique flow id: keys the surface's sessionStorage view state,
   * so two stories never restore each other's view. */
  flowId: string;
  entries: WorkflowInstanceEntry[];
  theme?: ExpeditionTheme;
  view?: "map" | "table";
  persistedOutputs?: FlowViewProps["persistedOutputs"];
};

/** FlowViewProps for the served flow-component: identity, the theme config
 * (static per flow), the fixed-id entries, and no-op callbacks — the shape
 * the served host hands the component, minus the page furniture it never
 * renders. */
export function flowSurfaceProps(options: FlowSurfaceOptions): FlowViewProps {
  const theme = options.theme ?? "mountain";
  return {
    flow: {
      id: options.flowId,
      label: "Router resilience",
      status: "waiting",
      config: { expeditionTheme: theme },
      revision: 7,
    },
    workflowDefs: wayfinderDefs(),
    entries: options.entries,
    customKinds: [],
    workflowCounts: [],
    availableFlowActions: wayfinderFlowActions,
    persistedOutputs: options.persistedOutputs ?? {},
    persistedOutputDirs: WAYFINDER_DECISION_RECORDS,
    onAction() {},
    onSendMessage: async () => {},
    onPatchState() {},
    onSelect() {},
    onFlowAction() {},
    onCreate() {},
  };
}

/** The persisted map document the charting anchors render in the drawer (the
 * flow's map.md, whitelisted through the engine's persisted-output seam). */
export const MAP_DOCUMENT =
  "# Route - Router resilience\n\nThe expedition charted three legs: the proxy seam, the metrics store, and the failover policy. The summit sits on the failover policy.\n";

// Instance-card props (the card family) ────────────────────────────────────

export function instanceCardProps(options: {
  def: WorkflowDefResponse;
  entry: WorkflowInstanceEntry;
}): InstanceComponentProps {
  return {
    workflowDef: options.def,
    instanceEntry: options.entry,
    customKinds: [],
    onAction() {},
    onSendMessage: async () => {},
  };
}

// Small shape helpers (fixed ids) ──────────────────────────────────────────

/** A ticket entry at an arbitrary state with a title and optional recorded
 * blockers (the engine-projected dependency fact drives frontier/blocked). */
export function ticketEntry(
  id: string,
  currentState: string,
  fields: Record<string, unknown> = {},
  dependencies: WorkflowInstanceEntry["dependencies"] = {
    blockers: [],
    unsatisfied: [],
  },
  actions: VisibleAction[] = []
): WorkflowInstanceEntry {
  const ticket = entry(id, currentState);
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = { title: id, ...fields };
  ticket.dependencies = dependencies;
  ticket.availableActions = actions;
  return ticket;
}
