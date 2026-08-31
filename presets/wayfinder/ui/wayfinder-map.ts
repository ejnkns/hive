/** The wayfinder map derivation (module-set sibling of the served flow
 * component): the pure dependency-aware presentation model — entries ->
 * nodes/edges/groups/destination/counts — that both the table's mini-map and
 * the full expedition map render from. A named export a test can import
 * directly as TypeScript, and a value-imported sibling of the served entry
 * (the server serves the module-set file tree to the browser with relative
 * imports rewritten to absolute versioned URLs). Hardcoded wayfinder state
 * ids are fine here — this IS wayfinder (the no-hardcoding invariant applies
 * to the generic surface, not to a preset's own data mapping).
 *
 * The model never reads DOM state and owns no animation state. A node's
 * identity is its WorkflowItem id (or the synthetic "base"/"summit" ids) —
 * never an array index. Dependency edges are derived only from the
 * `dependsOn` field already on the WorkflowItem state: no edge is invented
 * where the snapshot declares no relationship, and a `dependsOn` reference
 * with no matching WorkflowItem id stays as an unsatisfied edge (its
 * dependent must not look actionable). An edge is satisfied only when its
 * blocker ticket is `closed`; `out_of_scope` is a distinct terminal state
 * and never satisfies. Presentation status is derived UI state — the
 * canonical WorkflowItem state is never rewritten. */

import type { FlowViewProps } from "workflow-engine/workflow-types";

// The derived visual status of a map node. This is a presentation value, not
// a domain status: `frontier`/`blocked` are the two faces of a canonical
// `ready` ticket, `active` is any resolving/recording ticket, `decision` a
// closed one, `implementation` a build/buildItem record, and base/summit are
// the synthetic expedition anchors.
export type WayfinderPresentationStatus =
  | "base"
  | "fog"
  | "frontier"
  | "blocked"
  | "active"
  | "decision"
  | "out-of-scope"
  | "implementation"
  | "summit";

// The sidebar stations. The ascent is the one aggregated station (active,
// decision, and implementation share the journey path); every other status
// maps to its own station.
export type WayfinderGroupId =
  | "base"
  | "fog"
  | "frontier"
  | "blocked"
  | "ascent"
  | "out-of-scope"
  | "summit";

export type WayfinderNode = {
  id: string;
  presentation: WayfinderPresentationStatus;
  title: string;
  meta: string;
  x: number;
  y: number;
  workflowId: string;
  state: string;
  instanceId?: string;
  order?: number;
  // Dependency adjacency, derived from the WorkflowItem's `dependsOn`
  // snapshot. `blockers` names the ids this node depends on; `dependents`
  // is the reverse index the detail drawer renders.
  blockers: string[];
  dependents: string[];
};

// A directed dependency edge from a blocker to its dependent. `satisfied` is
// true only when the blocker ticket is `closed` (out-of-scope blockers are
// never satisfied; a dangling reference is never satisfied).
export type WayfinderEdge = {
  id: string;
  from: string;
  to: string;
  satisfied: boolean;
};

export type WayfinderGroup = {
  id: WayfinderGroupId;
  label: string;
  nodes: WayfinderNode[];
};

// Content-node counts per presentation status (base/summit are anchors, not
// content). The frontier HUD renders from these.
export type WayfinderCounts = {
  fog: number;
  frontier: number;
  blocked: number;
  active: number;
  decision: number;
  "out-of-scope": number;
  implementation: number;
};

export type WayfinderMap = {
  nodes: WayfinderNode[];
  edges: WayfinderEdge[];
  groups: WayfinderGroup[];
  destination: string;
  counts: WayfinderCounts;
};

// The expedition is empty when the map carries no content node — only the
// synthetic base/summit anchors. A newly created flow starts here; the
// map-first shell shows the Base Camp empty state until the first ticket or
// build exists.
export function expeditionIsEmpty(model: WayfinderMap): boolean {
  const counts = model.counts;
  return (
    counts.fog +
      counts.frontier +
      counts.blocked +
      counts.active +
      counts.decision +
      counts["out-of-scope"] +
      counts.implementation ===
    0
  );
}

// The charted fraction of the expedition journey, as a whole percent. The
// journey is the fog → frontier → decision path: fog, frontier, blocked,
// active, and decision tickets. Out-of-scope boundaries (ruled out, not
// charted) and implementation items (the build phase after the chart) are
// deliberately excluded — the bar measures how much of the map is charted.
export function wayfinderProgress(counts: WayfinderCounts): number {
  const journey =
    counts.fog +
    counts.frontier +
    counts.blocked +
    counts.active +
    counts.decision;
  if (journey === 0) return 0;
  return Math.round((counts.decision / journey) * 100);
}

export const RESOLVING_STATES = [
  "resolving_research",
  "resolving_prototype",
  "resolving_grilling",
  "resolving_task",
  "resolving_task_hitl",
  "recording",
];

export function deriveWayfinderMap(
  entries: FlowViewProps["entries"]
): WayfinderMap {
  const charting = entries.find((entry) => entry.workflowId === "charting");
  const tickets = entries.filter((entry) => entry.workflowId === "ticket");
  const builds = entries.filter((entry) => entry.workflowId === "build");
  const buildItems = entries.filter(
    (entry) => entry.workflowId === "buildItem"
  );

  // The dependency-satisfying set: an edge is satisfied only when its blocker
  // is a closed ticket. out_of_scope is a distinct terminal state and is
  // deliberately absent.
  const closedIds = new Set(
    tickets
      .filter((entry) => entry.state.currentState === "closed")
      .map((entry) => entry.id)
  );

  const destination =
    typeof charting?.state.workflowInstanceState.destination === "string"
      ? (charting.state.workflowInstanceState.destination as string)
      : "Destination";

  const nodes: WayfinderNode[] = [];

  if (charting !== undefined) {
    nodes.push(baseNode(charting));
  }

  const fog = tickets.filter((entry) => entry.state.currentState === "fog");
  fog.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      presentation: "fog",
      title: ticketTitle(entry),
      meta: "needs clarity",
      x: 24 + (index % 3) * 6,
      y: 73 + Math.floor(index / 3) * 5,
      workflowId: "ticket",
      state: "fog",
      instanceId: entry.id,
      blockers: dependsOnIds(entry),
      dependents: [],
    });
  });

  // Ready tickets split by their blockers: all closed -> the actionable
  // frontier; any unresolved blocker (or a dangling reference) -> blocked.
  const ready = tickets.filter((entry) => entry.state.currentState === "ready");
  const frontier: WayfinderNode[] = [];
  const blocked: WayfinderNode[] = [];
  ready.forEach((entry, index) => {
    const blockers = dependsOnIds(entry);
    const presentation: WayfinderPresentationStatus = blockers.every((id) =>
      closedIds.has(id)
    )
      ? "frontier"
      : "blocked";
    const node: WayfinderNode = {
      id: entry.id,
      presentation,
      title: ticketTitle(entry),
      meta:
        presentation === "frontier"
          ? `${ticketType(entry)} · claim`
          : `${ticketType(entry)} · blocked`,
      x: frontierX(index, ready.length),
      y: presentation === "frontier" ? 60 : 64,
      workflowId: "ticket",
      state: "ready",
      instanceId: entry.id,
      blockers,
      dependents: [],
    };
    (presentation === "frontier" ? frontier : blocked).push(node);
  });
  nodes.push(...frontier, ...blocked);

  const resolving = tickets.filter((entry) =>
    RESOLVING_STATES.includes(entry.state.currentState)
  );
  const decisions = tickets.filter(
    (entry) => entry.state.currentState === "closed"
  );
  const outOfScope = tickets.filter(
    (entry) => entry.state.currentState === "out_of_scope"
  );

  // The ascent is the one ordered sub-path: active -> decisions ->
  // implementations -> the summit. Everything else is grouped, not chained.
  const ascent: WayfinderNode[] = [];
  resolving.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      presentation: "active",
      title: ticketTitle(entry),
      meta: resolvingLabel(entry.state.currentState),
      x: 56,
      y: 50 - index * 3,
      workflowId: "ticket",
      state: entry.state.currentState,
      instanceId: entry.id,
      blockers: dependsOnIds(entry),
      dependents: [],
    });
  });
  decisions.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      presentation: "decision",
      title: ticketTitle(entry),
      meta: ticketType(entry),
      x: 52 - index * 3,
      y: 38 - index * 5,
      workflowId: "ticket",
      state: "closed",
      instanceId: entry.id,
      blockers: dependsOnIds(entry),
      dependents: [],
    });
  });
  [...builds, ...buildItems].forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      presentation: "implementation",
      title: implementationTitle(entry),
      meta:
        entry.workflowId === "buildItem"
          ? "build item"
          : entry.state.currentState,
      x: 70 + index * 2,
      y: 17 - index * 3,
      workflowId: entry.workflowId,
      state: entry.state.currentState,
      instanceId: entry.id,
      blockers: dependsOnIds(entry),
      dependents: [],
    });
  });
  ascent.forEach((node, index) => {
    node.order = index;
  });
  nodes.push(...ascent);

  outOfScope.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      presentation: "out-of-scope",
      title: ticketTitle(entry),
      meta: "ruled out",
      x: 6 + index * 4,
      y: 92,
      workflowId: "ticket",
      state: "out_of_scope",
      instanceId: entry.id,
      blockers: dependsOnIds(entry),
      dependents: [],
    });
  });

  nodes.push({
    id: "summit",
    presentation: "summit",
    title: destination,
    meta: "destination",
    x: 84,
    y: 10,
    workflowId: "charting",
    state: charting?.state.currentState ?? "",
    blockers: [],
    dependents: [],
  });

  fillDependents(nodes);

  return {
    nodes,
    edges: buildEdges(nodes, closedIds),
    groups: buildGroups(nodes),
    destination,
    counts: deriveCounts(nodes),
  };
}

// The station a presentation status belongs to — the single grouping helper
// the renderers (sidebar, layout, HUD) share.
export function wayfinderGroupOf(
  presentation: WayfinderPresentationStatus
): WayfinderGroupId {
  switch (presentation) {
    case "base":
      return "base";
    case "fog":
      return "fog";
    case "frontier":
      return "frontier";
    case "blocked":
      return "blocked";
    case "active":
    case "decision":
    case "implementation":
      return "ascent";
    case "out-of-scope":
      return "out-of-scope";
    case "summit":
      return "summit";
  }
}

export function ticketTitle(entry: FlowViewProps["entries"][number]): string {
  const state = entry.state.workflowInstanceState;
  if (typeof state.title === "string" && state.title !== "") return state.title;
  if (typeof state.brief === "string" && state.brief !== "") return state.brief;
  return entry.id;
}

export function implementationTitle(
  entry: FlowViewProps["entries"][number]
): string {
  if (entry.workflowId === "buildItem") {
    const ticket = entry.state.workflowInstanceState.ticket;
    if (typeof ticket === "object" && ticket !== null) {
      const title = (ticket as Record<string, unknown>).title;
      if (typeof title === "string" && title !== "") return title;
    }
    return "Build item";
  }
  return "Build";
}

export function resolvingLabel(state: string): string {
  switch (state) {
    case "resolving_research":
      return "research";
    case "resolving_prototype":
      return "prototype";
    case "resolving_grilling":
      return "grilling";
    case "resolving_task":
      return "task";
    case "resolving_task_hitl":
      return "task (session)";
    case "recording":
      return "recording";
    default:
      return state;
  }
}

function baseNode(charting: FlowViewProps["entries"][number]): WayfinderNode {
  return {
    id: "base",
    presentation: "base",
    title: "Base camp",
    meta: "charting",
    x: 12,
    y: 84,
    workflowId: "charting",
    state: charting.state.currentState,
    instanceId: charting.id,
    blockers: [],
    dependents: [],
  };
}

// The declared dependency references on a WorkflowItem, defensively read:
// a missing or non-array `dependsOn` reads as no blockers, non-string entries
// are dropped, and duplicates collapse. A reference that names no entry in
// the snapshot is kept (it still blocks its dependent) — see buildEdges.
function dependsOnIds(entry: FlowViewProps["entries"][number]): string[] {
  const dependsOn: unknown = entry.state.workflowInstanceState.dependsOn;
  if (!Array.isArray(dependsOn)) return [];
  const ids = dependsOn.filter(
    (value): value is string => typeof value === "string"
  );
  return [...new Set(ids)];
}

function fillDependents(nodes: WayfinderNode[]): void {
  const dependentsOf = new Map<string, string[]>();
  for (const node of nodes) {
    for (const blockerId of node.blockers) {
      const list = dependentsOf.get(blockerId) ?? [];
      list.push(node.id);
      dependentsOf.set(blockerId, list);
    }
  }
  for (const node of nodes) {
    node.dependents = dependentsOf.get(node.id) ?? [];
  }
}

function buildEdges(
  nodes: readonly WayfinderNode[],
  closedIds: ReadonlySet<string>
): WayfinderEdge[] {
  const edges: WayfinderEdge[] = [];
  for (const node of nodes) {
    for (const blockerId of node.blockers) {
      edges.push({
        id: `${blockerId}->${node.id}`,
        from: blockerId,
        to: node.id,
        satisfied: closedIds.has(blockerId),
      });
    }
  }
  return edges;
}

// The stations in sidebar order. The ascent aggregates the journey statuses;
// every other station is one status. Blocked sits apart from the frontier —
// the actionable frontier and the stuck behind it are different stations.
const GROUP_ORDER: readonly WayfinderGroupId[] = [
  "base",
  "fog",
  "frontier",
  "blocked",
  "ascent",
  "out-of-scope",
  "summit",
];

const GROUP_LABELS: Record<WayfinderGroupId, string> = {
  base: "Base camp",
  fog: "The fog",
  frontier: "The frontier",
  blocked: "Blocked",
  ascent: "The ascent",
  "out-of-scope": "Do not enter",
  summit: "The summit",
};

function buildGroups(nodes: readonly WayfinderNode[]): WayfinderGroup[] {
  return GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id],
    nodes: nodes.filter((node) => wayfinderGroupOf(node.presentation) === id),
  }));
}

function deriveCounts(nodes: readonly WayfinderNode[]): WayfinderCounts {
  const counts: WayfinderCounts = {
    fog: 0,
    frontier: 0,
    blocked: 0,
    active: 0,
    decision: 0,
    "out-of-scope": 0,
    implementation: 0,
  };
  for (const node of nodes) {
    if (node.presentation === "base" || node.presentation === "summit") {
      continue;
    }
    counts[node.presentation] += 1;
  }
  return counts;
}

function ticketType(entry: FlowViewProps["entries"][number]): string {
  const type = entry.state.workflowInstanceState.type;
  return typeof type === "string" ? type : "ticket";
}

function frontierX(index: number, count: number): number {
  if (count <= 1) return 33;
  return 20 + (index * 26) / (count - 1);
}
