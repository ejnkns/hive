/** Honeycomb's shared served-component vocabulary. The design language is
 * "a hive of ideas": amber honey on warm dark wax, each taxonomy category a
 * hive (a compact honeycomb-tiled patch of cells), each idea a cell whose
 * honey fill level is its status. Type-only — the shared primitives are
 * small so each served module inlines its own css/html fragments. */

import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";

// The card-level status field the ideas workflow edits. The visual language
// maps each status to a honey state: backlog = empty wax, in-progress =
// filling, done = capped golden honey, parked = ghost comb, blocked =
// crystallized (dark, alarming).
export type CellStatus =
  | "backlog"
  | "in-progress"
  | "blocked"
  | "done"
  | "parked";

export const CELL_STATUSES: readonly CellStatus[] = [
  "backlog",
  "in-progress",
  "blocked",
  "done",
  "parked",
];

export function isCellStatus(value: unknown): value is CellStatus {
  return (
    typeof value === "string" &&
    (CELL_STATUSES as readonly string[]).includes(value)
  );
}

// One idea cell: the classified idea card laid out on the hex grid. The
// identity is the workflow instance id — never an array index. World
// position (x, y) is computed by the layout (hex-layout.ts) at derivation
// time; the surface renders from these directly.
export type CombCell = {
  id: string;
  title: string;
  category: string;
  status: CellStatus;
  priority: string | undefined;
  effort: string | undefined;
  tags: string[];
  summary: string | undefined;
  originalText: string | undefined;
  // Axial hex coordinates within the hive's patch (assigned by the layout's
  // compact ring fill).
  q: number;
  r: number;
  // World position of the cell center, in pixels at cell scale.
  x: number;
  y: number;
  // The full workflow instance entry, for the detail face (availableActions,
  // editFields) and the escape hatch.
  entry: WorkflowInstanceEntry;
};

// One taxonomy category as a hive: a representative hexagon at overview
// distance that expands into its member cells' honeycomb patch when the
// camera zooms in.
export type Hive = {
  // The category name — a hive's identity.
  id: string;
  label: string;
  cells: CombCell[];
  // Axial coordinates on the hive lattice (the overview arrangement).
  hq: number;
  hr: number;
  // World position of the hive center, in pixels at hive scale.
  x: number;
  y: number;
  // World radius of the patch around the hive center (cells + a cell of
  // breathing room), the fit target when the camera zooms in.
  patchRadius: number;
};

export type HoneycombMap = {
  hives: Hive[];
  // Every classified idea across all hives.
  total: number;
  // The cell circumradius and hive lattice scale, in world pixels — carried
  // so the surface renders and fits with the same numbers the layout used.
  cellScale: number;
  hiveScale: number;
};

// Defensive reads off a workflow-instance entry's state: the ideas workflow
// declares these fields, but a card mid-import (or hand-built in a test)
// may lack any of them.
export function cellTitle(entry: WorkflowInstanceEntry): string {
  const title = entry.state.workflowInstanceState.title;
  return typeof title === "string" && title !== "" ? title : entry.id;
}

export function cellCategory(entry: WorkflowInstanceEntry): string {
  const category = entry.state.workflowInstanceState.category;
  return typeof category === "string" && category !== ""
    ? category
    : "Uncategorized";
}

export function cellStatus(entry: WorkflowInstanceEntry): CellStatus {
  return isCellStatus(entry.state.workflowInstanceState.status)
    ? entry.state.workflowInstanceState.status
    : "backlog";
}

export function cellTags(entry: WorkflowInstanceEntry): string[] {
  const tags = entry.state.workflowInstanceState.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === "string");
}

export function cellString(
  entry: WorkflowInstanceEntry,
  field: "summary" | "originalText" | "priority" | "effort"
): string | undefined {
  const value = entry.state.workflowInstanceState[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}
