/** @private — only imported by map-canvas.ts and its test. The wayfinder map
 * transitions: the pure diff between two derived map snapshots that live
 * update feedback renders from — the ids that arrived since the previous
 * snapshot (the entrance wave) and the nodes whose derived presentation
 * status changed (the flare marks). Node identity is the stable WorkflowItem
 * id, never an array index; a removed node is reported as neither. The
 * transitions are derived UI state — the canonical WorkflowItem state is
 * never rewritten, and this module reads no DOM and owns no animation. */

import type {
  WayfinderMap,
  WayfinderPresentationStatus,
} from "./wayfinder-map.ts";

/** One node whose derived presentation status changed between snapshots. */
export type WayfinderStatusChange = {
  id: string;
  from: WayfinderPresentationStatus;
  to: WayfinderPresentationStatus;
};

/** The transition between two snapshots: newly arrived node ids and the
 * presentation status changes of the survivors. */
export type WayfinderMapTransitions = {
  addedIds: string[];
  statusChanges: WayfinderStatusChange[];
};

/** Diff the previous snapshot (undefined on first load — every node counts
 * as arriving) against the next one. Survivors whose presentation held —
 * even when their title, meta, or state text changed — report nothing, so
 * ordinary data refreshes never flare the map. */
export function deriveMapTransitions(
  previous: WayfinderMap | undefined,
  next: WayfinderMap
): WayfinderMapTransitions {
  if (previous === undefined) {
    return { addedIds: next.nodes.map((node) => node.id), statusChanges: [] };
  }
  const previousPresentations = new Map(
    previous.nodes.map((node) => [node.id, node.presentation])
  );
  const addedIds: string[] = [];
  const statusChanges: WayfinderStatusChange[] = [];
  for (const node of next.nodes) {
    const before = previousPresentations.get(node.id);
    if (before === undefined) {
      addedIds.push(node.id);
    } else if (before !== node.presentation) {
      statusChanges.push({ id: node.id, from: before, to: node.presentation });
    }
  }
  return { addedIds, statusChanges };
}
