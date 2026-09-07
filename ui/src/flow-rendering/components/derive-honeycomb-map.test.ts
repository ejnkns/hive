// The honeycomb map derivation: entries → hives/cells — grouping, ordering,
// patch geometry, adaptive hive spacing, and the status counts. Tested at
// the pure seam (a named export of the honeycomb-map module, imported
// directly as TypeScript) with node --test, like the wayfinder derivation.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import {
  CELL_SCALE,
  SQRT3,
} from "../../../../presets/honeycomb/ui/hex-layout.ts";
import {
  combBounds,
  deriveHoneycombMap,
  deriveStatusCounts,
} from "../../../../presets/honeycomb/ui/honeycomb-map.ts";

// A minimal full WorkflowInstanceEntry for a honeycomb idea card (the fields
// the derivation reads are workflowId, currentState, and
// workflowInstanceState).
function idea(
  id: string,
  fields: Record<string, unknown>
): WorkflowInstanceEntry {
  return {
    id,
    workflowId: "ideas",
    state: {
      currentState: "classified",
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      taskOutputs: {},
      workflowInstanceState: { ...fields },
      history: [],
    },
    availableActions: [],
    dependencies: { blockers: [], unsatisfied: [] },
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

function cellById(map: ReturnType<typeof deriveHoneycombMap>, id: string) {
  const cell = map.hives.flatMap((h) => h.cells).find((c) => c.id === id);
  assert.ok(cell !== undefined, `cell ${id} missing`);
  return cell;
}

describe("deriveHoneycombMap", () => {
  it("collects only the ideas workflow's entries as cells", () => {
    const other: WorkflowInstanceEntry = {
      ...idea("x-1", { title: "Not an idea" }),
      workflowId: "imports",
    };
    const map = deriveHoneycombMap([
      other,
      idea("i-1", { title: "One", category: "Alpha" }),
      idea("i-2", { title: "Two", category: "Beta" }),
    ]);
    assert.equal(map.total, 2);
    assert.deepEqual(map.hives.map((h) => h.id).sort(), ["Alpha", "Beta"]);
  });

  it("groups cells by category into alphabetical hives, Uncategorized last", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", category: "Zebra" }),
      idea("i-2", { title: "Two" }), // no category → Uncategorized
      idea("i-3", { title: "Three", category: "Alpha" }),
      idea("i-4", { title: "Four", category: "Zebra" }),
    ]);
    assert.deepEqual(
      map.hives.map((h) => h.id),
      ["Alpha", "Zebra", "Uncategorized"]
    );
    assert.deepEqual(
      map.hives[0].cells.map((c) => c.id),
      ["i-3"]
    );
    assert.deepEqual(
      map.hives[1].cells.map((c) => c.id),
      ["i-1", "i-4"]
    );
    assert.deepEqual(
      map.hives[2].cells.map((c) => c.id),
      ["i-2"]
    );
  });

  it("reads the card fields off the instance state, with defensive fallbacks", () => {
    const map = deriveHoneycombMap([
      idea("i-1", {
        title: "Split the parser",
        category: "Parsing",
        status: "in-progress",
        priority: "p1",
        effort: "M",
        tags: ["engine", "flow"],
        summary: "The digest split.",
        originalText: "the raw paste",
      }),
    ]);
    const cell = cellById(map, "i-1");
    assert.equal(cell.title, "Split the parser");
    assert.equal(cell.category, "Parsing");
    assert.equal(cell.status, "in-progress");
    assert.equal(cell.priority, "p1");
    assert.equal(cell.effort, "M");
    assert.deepEqual(cell.tags, ["engine", "flow"]);
    assert.equal(cell.summary, "The digest split.");
    assert.equal(cell.originalText, "the raw paste");
  });

  it("defaults a missing status to backlog, a missing title to the id, and the category to Uncategorized", () => {
    const map = deriveHoneycombMap([idea("i-1", {})]);
    const cell = cellById(map, "i-1");
    assert.equal(cell.status, "backlog");
    assert.equal(cell.title, "i-1");
    assert.equal(cell.category, "Uncategorized");
    assert.deepEqual(cell.tags, []);
  });

  it("drops non-string tag entries", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", tags: ["good", 42, null, "also"] }),
    ]);
    assert.deepEqual(cellById(map, "i-1").tags, ["good", "also"]);
  });

  it("lays each hive's cells on compact ring coordinates around the hive center", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", category: "A" }),
      idea("i-2", { title: "Two", category: "A" }),
      idea("i-3", { title: "Three", category: "A" }),
    ]);
    const hive = map.hives[0];
    assert.equal(hive.cells[0].q, 0);
    assert.equal(hive.cells[0].r, 0);
    // The second cell is a hex-distance-1 neighbor of the first.
    const second = hive.cells[1];
    const distance =
      (Math.abs(second.q) +
        Math.abs(second.r) +
        Math.abs(second.q + second.r)) /
      2;
    assert.equal(distance, 1);
    // World positions: the patch center plus the axial offset.
    assert.ok(Math.abs(hive.cells[0].x - hive.x) < 1e-9);
    assert.ok(Math.abs(hive.cells[0].y - hive.y) < 1e-9);
  });

  it("spaces hive centers exactly hiveScale·√3 apart on one lattice row", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", category: "A" }),
      idea("i-2", { title: "Two", category: "B" }),
      idea("i-3", { title: "Three", category: "C" }),
    ]);
    const [a, b] = map.hives;
    assert.ok(
      Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - map.hiveScale * SQRT3) < 1e-6
    );
  });

  it("grows the hive scale so large patches never touch their neighbors", () => {
    const ideas = Array.from({ length: 30 }, (_, i) =>
      idea(`i-${i}`, {
        title: `Idea ${i}`,
        category: i < 29 ? "Big" : "Small",
      })
    );
    const map = deriveHoneycombMap(ideas);
    const big = map.hives.find((h) => h.id === "Big")!;
    const small = map.hives.find((h) => h.id === "Small")!;
    const centerDistance = Math.hypot(big.x - small.x, big.y - small.y);
    assert.ok(centerDistance >= big.patchRadius + small.patchRadius);
  });

  it("carries the cell and hive scales through to the renderers", () => {
    const map = deriveHoneycombMap([idea("i-1", { title: "One" })]);
    assert.equal(map.cellScale, CELL_SCALE);
    assert.ok(map.hiveScale > 0);
  });

  it("is deterministic across runs with the same entries", () => {
    const entries = [
      idea("i-1", { title: "One", category: "B" }),
      idea("i-2", { title: "Two", category: "A" }),
    ];
    assert.equal(
      JSON.stringify(deriveHoneycombMap(entries)),
      JSON.stringify(deriveHoneycombMap([...entries]))
    );
  });
});

describe("combBounds", () => {
  it("covers every hive plus its patch radius", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", category: "A" }),
      idea("i-2", { title: "Two", category: "B" }),
    ]);
    const bounds = combBounds(map)!;
    for (const hive of map.hives) {
      assert.ok(hive.x - hive.patchRadius >= bounds.minX);
      assert.ok(hive.x + hive.patchRadius <= bounds.maxX);
      assert.ok(hive.y - hive.patchRadius >= bounds.minY);
      assert.ok(hive.y + hive.patchRadius <= bounds.maxY);
    }
  });

  it("is undefined for an empty comb", () => {
    assert.equal(combBounds(deriveHoneycombMap([])), undefined);
  });
});

describe("deriveStatusCounts", () => {
  it("counts each cell's status, unknown statuses reading as backlog", () => {
    const map = deriveHoneycombMap([
      idea("i-1", { title: "One", status: "done" }),
      idea("i-2", { title: "Two", status: "in-progress" }),
      idea("i-3", { title: "Three" }),
      idea("i-4", { title: "Four", status: "blocked" }),
      idea("i-5", { title: "Five", status: "parked" }),
      idea("i-6", { title: "Six", status: "bogus" }),
    ]);
    assert.deepEqual(deriveStatusCounts(map), {
      backlog: 2,
      "in-progress": 1,
      blocked: 1,
      done: 1,
      parked: 1,
    });
  });
});
