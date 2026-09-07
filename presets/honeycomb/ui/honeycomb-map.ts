/** The honeycomb map derivation (module-set sibling of the served flow
 * component): the pure presentation model — flow entries → hives/cells/
 * scales — the comb surface renders from. A named export a test can import
 * directly as TypeScript, and a value-imported sibling of the served entry.
 * Hardcoded honeycomb workflow/field names are fine here — this IS
 * honeycomb (the no-hardcoding invariant applies to the generic surface,
 * not to a preset's own data mapping).
 *
 * The model never reads DOM state and owns no animation state. A cell's
 * identity is the workflow instance id. Hive order is alphabetical
 * (Uncategorized last) so the map is fully deterministic regardless of the
 * snapshot's entry order or which categories exist. Positions are derived —
 * no position persistence (deferred engine work); the layout is a pure
 * function of the category set and the per-category counts, so the comb
 * reflows deterministically as ideas land. */

import type { FlowViewProps } from "workflow-engine/workflow-types";
import {
  axialToWorld,
  boundsOf,
  CELL_SCALE,
  MIN_HIVE_SCALE,
  PATCH_GAP,
  patchCoords,
  SQRT3,
} from "./hex-layout.ts";
import {
  type CellStatus,
  type CombCell,
  cellCategory,
  cellStatus,
  cellString,
  cellTags,
  cellTitle,
  type Hive,
  type HoneycombMap,
} from "./shared.ts";

type Entries = FlowViewProps["entries"];

// The distance from a patch's center to its farthest cell center, plus one
// cell circumradius of corner overhang — the reach the camera fits against
// and the spacing keeps clear of neighbors.
function patchWorldRadius(coords: readonly { q: number; r: number }[]): number {
  let maxDistance = 0;
  for (const coord of coords) {
    const point = axialToWorld(coord.q, coord.r, CELL_SCALE);
    maxDistance = Math.max(maxDistance, Math.hypot(point.x, point.y));
  }
  return maxDistance + CELL_SCALE;
}

/** Derive the honeycomb map from the flow snapshot's entries: every ideas
 * workflow instance becomes one cell, grouped into alphabetical hives by
 * category (Uncategorized last), patches laid out compactly, hives spaced
 * on their own honeycomb lattice far enough apart that no two patches
 * touch. */
export function deriveHoneycombMap(entries: Entries): HoneycombMap {
  const ideas = entries.filter((entry) => entry.workflowId === "ideas");

  // Group cells by category, preserving first-appearance order of the
  // category names for deterministic alphabetical sorting below.
  const byCategory = new Map<string, Omit<CombCell, "q" | "r" | "x" | "y">[]>();
  for (const entry of ideas) {
    const category = cellCategory(entry);
    const cells = byCategory.get(category) ?? [];
    cells.push(makeCell(entry));
    byCategory.set(category, cells);
  }

  // Alphabetical hive order; Uncategorized sorts last so the import
  // fallback never crowds the named taxonomy.
  const labels = [...byCategory.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  // Per-hive geometry first: patch coords and world radius.
  const patches = labels.map((label) => {
    const cells = byCategory.get(label) ?? [];
    return { label, cells, coords: patchCoords(cells.length) };
  });
  const maxPatchRadius = Math.max(
    0,
    ...patches.map((patch) => patchWorldRadius(patch.coords))
  );

  // The hive lattice scale: far enough apart that neighboring patches plus
  // the gap never touch (adjacent hive centers are hiveScale·√3 apart).
  const hiveScale = Math.max(
    MIN_HIVE_SCALE,
    (2 * maxPatchRadius + PATCH_GAP) / SQRT3
  );

  // Hive lattice positions: the same compact ring fill, one hexagon per
  // hive, centered on the comb origin.
  const hiveCoords = patchCoords(patches.length);

  const hives: Hive[] = patches.map((patch, index) => {
    const lattice = hiveCoords[index] ?? { q: 0, r: 0 };
    const center = axialToWorld(lattice.q, lattice.r, hiveScale);
    const patchRadius = patchWorldRadius(patch.coords);
    const cells: CombCell[] = patch.cells.map((cell, cellIndex) => {
      const coord = patch.coords[cellIndex] ?? { q: 0, r: 0 };
      const offset = axialToWorld(coord.q, coord.r, CELL_SCALE);
      return {
        ...cell,
        q: coord.q,
        r: coord.r,
        x: center.x + offset.x,
        y: center.y + offset.y,
      };
    });
    return {
      id: patch.label,
      label: patch.label,
      cells,
      hq: lattice.q,
      hr: lattice.r,
      x: center.x,
      y: center.y,
      patchRadius,
    };
  });

  return {
    hives,
    total: ideas.length,
    cellScale: CELL_SCALE,
    hiveScale,
  };
}

function makeCell(
  entry: Entries[number]
): Omit<CombCell, "q" | "r" | "x" | "y"> {
  return {
    id: entry.id,
    title: cellTitle(entry),
    category: cellCategory(entry),
    status: cellStatus(entry),
    priority: cellString(entry, "priority"),
    effort: cellString(entry, "effort"),
    tags: cellTags(entry),
    summary: cellString(entry, "summary"),
    originalText: cellString(entry, "originalText"),
    entry,
  };
}

// The overall bounds of the whole comb (hive centers + their patch radii),
// the fit-all camera target. Undefined for an empty comb.
export function combBounds(
  map: HoneycombMap
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  return boundsOf(
    map.hives.map((hive) => ({ x: hive.x, y: hive.y })),
    map.hiveScale + Math.max(0, ...map.hives.map((hive) => hive.patchRadius))
  );
}

// The status counts the HUD reads (the "how full is the hive" summary).
export function deriveStatusCounts(
  map: HoneycombMap
): Record<CellStatus, number> {
  const counts: Record<CellStatus, number> = {
    backlog: 0,
    "in-progress": 0,
    blocked: 0,
    done: 0,
    parked: 0,
  };
  for (const hive of map.hives) {
    for (const cell of hive.cells) {
      counts[cell.status] += 1;
    }
  }
  return counts;
}
