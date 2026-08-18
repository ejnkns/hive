/** The wayfinder map derivation (module-set sibling of the served flow
 * component): the pure model — entries -> nodes/groups/positions — that both
 * the table's mini-map and the full expedition map render from. A named
 * export a test can import directly as TypeScript, and a value-imported
 * sibling of the served entry (the server serves the module-set file tree to
 * the browser with relative imports rewritten to absolute versioned URLs).
 * Hardcoded wayfinder state ids are fine here — this IS wayfinder (the
 * no-hardcoding invariant applies to the generic surface, not to a preset's
 * own data mapping). */

import type { FlowViewProps } from "workflow-engine/workflow-types";

export type WayfinderNodeKind =
  | "base"
  | "fog"
  | "ready"
  | "resolving"
  | "decision"
  | "out-of-scope"
  | "implementation"
  | "summit";

export type WayfinderGroupId =
  | "base"
  | "fog"
  | "frontier"
  | "ascent"
  | "out-of-scope"
  | "summit";

export type WayfinderNode = {
  id: string;
  kind: WayfinderNodeKind;
  title: string;
  meta: string;
  x: number;
  y: number;
  workflowId: string;
  state: string;
  instanceId?: string;
  order?: number;
};

export type WayfinderGroup = {
  id: WayfinderGroupId;
  label: string;
  nodes: WayfinderNode[];
};

export type WayfinderMap = {
  nodes: WayfinderNode[];
  groups: WayfinderGroup[];
  destination: string;
};

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

  const destination =
    typeof charting?.state.workflowInstanceState.destination === "string"
      ? (charting.state.workflowInstanceState.destination as string)
      : "Destination";

  const nodes: WayfinderNode[] = [];

  if (charting !== undefined) {
    nodes.push({
      id: "base",
      kind: "base",
      title: "Base camp",
      meta: "charting",
      x: 12,
      y: 84,
      workflowId: "charting",
      state: charting.state.currentState,
      instanceId: charting.id,
    });
  }

  const fog = tickets.filter((entry) => entry.state.currentState === "fog");
  fog.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "fog",
      title: ticketTitle(entry),
      meta: "needs clarity",
      x: 24 + (index % 3) * 6,
      y: 73 + Math.floor(index / 3) * 5,
      workflowId: "ticket",
      state: "fog",
      instanceId: entry.id,
    });
  });

  const ready = tickets.filter((entry) => entry.state.currentState === "ready");
  ready.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "ready",
      title: ticketTitle(entry),
      meta: `${ticketType(entry)} · claim`,
      x: frontierX(index, ready.length),
      y: 60,
      workflowId: "ticket",
      state: "ready",
      instanceId: entry.id,
    });
  });

  const resolving = tickets.filter((entry) =>
    RESOLVING_STATES.includes(entry.state.currentState)
  );
  const decisions = tickets.filter(
    (entry) => entry.state.currentState === "closed"
  );
  const outOfScope = tickets.filter(
    (entry) => entry.state.currentState === "out_of_scope"
  );

  // The ascent is the one ordered sub-path: resolving -> decisions ->
  // implementations -> the summit. Everything else is grouped, not chained.
  const ascent: WayfinderNode[] = [];
  resolving.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "resolving",
      title: ticketTitle(entry),
      meta: resolvingLabel(entry.state.currentState),
      x: 56,
      y: 50 - index * 3,
      workflowId: "ticket",
      state: entry.state.currentState,
      instanceId: entry.id,
    });
  });
  decisions.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "decision",
      title: ticketTitle(entry),
      meta: ticketType(entry),
      x: 52 - index * 3,
      y: 38 - index * 5,
      workflowId: "ticket",
      state: "closed",
      instanceId: entry.id,
    });
  });
  [...builds, ...buildItems].forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "implementation",
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
    });
  });
  ascent.forEach((node, index) => {
    node.order = index;
  });
  nodes.push(...ascent);

  outOfScope.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "out-of-scope",
      title: ticketTitle(entry),
      meta: "ruled out",
      x: 6 + index * 4,
      y: 92,
      workflowId: "ticket",
      state: "out_of_scope",
      instanceId: entry.id,
    });
  });

  nodes.push({
    id: "summit",
    kind: "summit",
    title: destination,
    meta: "destination",
    x: 84,
    y: 10,
    workflowId: "charting",
    state: charting?.state.currentState ?? "",
  });

  return { nodes, groups: buildGroups(nodes), destination };
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

function ticketType(entry: FlowViewProps["entries"][number]): string {
  const type = entry.state.workflowInstanceState.type;
  return typeof type === "string" ? type : "ticket";
}

function frontierX(index: number, count: number): number {
  if (count <= 1) return 33;
  return 20 + (index * 26) / (count - 1);
}

function buildGroups(nodes: WayfinderNode[]): WayfinderGroup[] {
  const defs: Array<{
    id: WayfinderGroupId;
    label: string;
    kinds: WayfinderNodeKind[];
  }> = [
    { id: "base", label: "Base camp", kinds: ["base"] },
    { id: "fog", label: "The fog", kinds: ["fog"] },
    { id: "frontier", label: "The frontier", kinds: ["ready"] },
    {
      id: "ascent",
      label: "The ascent",
      kinds: ["resolving", "decision", "implementation"],
    },
    { id: "out-of-scope", label: "Do not enter", kinds: ["out-of-scope"] },
    { id: "summit", label: "The summit", kinds: ["summit"] },
  ];
  return defs.map((def) => ({
    id: def.id,
    label: def.label,
    nodes: nodes.filter((node) => def.kinds.includes(node.kind)),
  }));
}
