// The wayfinder deterministic spatial layout: the pure rank-biased layout
// seam over the derived map model — world-coordinate positions per node id,
// a warm layout that preserves the positions of ids already on screen, and
// a bounds helper for camera fitting. Tested at the pure seam (a named
// export of the wayfinder-layout module, imported directly as TypeScript)
// rather than through the DOM, so determinism, order independence, rank
// bias, and warm-position preservation have deterministic coverage before
// any canvas draws.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import {
  layoutWayfinderMap,
  layoutWayfinderMapWarm,
  wayfinderLayoutBounds,
} from "../../../../presets/wayfinder/ui/wayfinder-layout.ts";
import {
  deriveWayfinderMap,
  type WayfinderMap,
} from "../../../../presets/wayfinder/ui/wayfinder-map.ts";
import { wayfinderFixtureEntries } from "./wayfinder-fixtures.ts";

// A truly empty map at the layout seam (no nodes at all — not even the
// synthetic anchors the derivation always adds).
const EMPTY_MAP: WayfinderMap = {
  nodes: [],
  edges: [],
  groups: [],
  destination: "",
  counts: {
    fog: 0,
    frontier: 0,
    blocked: 0,
    active: 0,
    decision: 0,
    "out-of-scope": 0,
    implementation: 0,
  },
};

// A minimal full WorkflowInstanceEntry for a wayfinder instance (the fields
// the derivation reads are workflowId, currentState, and
// workflowInstanceState).
function instance(
  workflowId: string,
  id: string,
  currentState: string,
  instanceState: Record<string, unknown> = {}
): WorkflowInstanceEntry {
  return {
    id,
    workflowId,
    state: {
      currentState,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      taskOutputs: {},
      workflowInstanceState: instanceState,
      history: [],
    },
    availableActions: [],
    dependencies: { blockers: [], unsatisfied: [] },
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

const charting = () =>
  instance("charting", "c-1", "charted", {
    destination: "hive router",
    notes: "offline-first",
  });

function ticket(
  id: string,
  state: string,
  instanceState: Record<string, unknown> = {}
): WorkflowInstanceEntry {
  return instance("ticket", id, state, instanceState);
}

describe("layoutWayfinderMap", () => {
  it("returns no positions for an empty map", () => {
    const positions = layoutWayfinderMap(EMPTY_MAP);
    assert.equal(positions.size, 0);
  });

  it("places a lone node at a finite world position", () => {
    const map = deriveWayfinderMap([charting()]);
    const positions = layoutWayfinderMap(map);
    assert.equal(positions.size, 2); // base + summit
    for (const position of positions.values()) {
      assert.equal(Number.isFinite(position.x), true);
      assert.equal(Number.isFinite(position.y), true);
    }
  });

  it("lays out the same map identically on repeated calls", () => {
    const map = deriveWayfinderMap([
      charting(),
      ticket("t-fog", "fog"),
      ticket("t-ready", "ready", { title: "Pick the next ticket" }),
      ticket("t-closed", "closed"),
    ]);
    const first = layoutWayfinderMap(map);
    const second = layoutWayfinderMap(map);
    assert.deepEqual([...first], [...second]);
  });

  it("keeps every pair of nodes reasonably apart on the baseline snapshot", () => {
    const map = deriveWayfinderMap(wayfinderFixtureEntries());
    const positions = layoutWayfinderMap(map);
    // Nodes render as stars; any pair closer than a star's diameter (with
    // generous headroom) reads as one blob. No threshold is magic — this is
    // the collapse guard, not an aesthetic claim.
    const MIN_SEPARATION = 40;
    for (const [idA, a] of positions) {
      for (const [idB, b] of positions) {
        if (idA >= idB) continue; // each unordered pair exactly once
        const separation = Math.hypot(a.x - b.x, a.y - b.y);
        assert.equal(
          separation >= MIN_SEPARATION,
          true,
          `${idA} and ${idB} are only ${separation.toFixed(1)} apart`
        );
      }
    }
  });

  it("pins base camp at the origin and biases deeper dependencies outward", () => {
    const map = deriveWayfinderMap([
      charting(),
      ticket("t-a", "closed", { title: "Root decision" }),
      ticket("t-b", "closed", { title: "Next step", dependsOn: ["t-a"] }),
      ticket("t-c", "closed", { title: "Final step", dependsOn: ["t-b"] }),
    ]);
    const positions = layoutWayfinderMap(map);
    const distance = (id: string) =>
      Math.hypot(
        positions.get(id)?.x ?? Number.NaN,
        positions.get(id)?.y ?? Number.NaN
      );
    assert.deepEqual(positions.get("base"), { x: 0, y: 0 });
    // The dependency chain a -> b -> c walks outward from the core: a
    // blocker sits closer to base camp than what it unblocks.
    assert.equal(distance("t-a") < distance("t-b"), true);
    assert.equal(distance("t-b") < distance("t-c"), true);
    // The summit anchors the outermost ring of all.
    assert.equal(distance("summit") > distance("t-c"), true);
  });

  it("is independent of the node and edge array order", () => {
    const entries = [
      charting(),
      ticket("t-a", "ready", { title: "Root ticket" }),
      ticket("t-b", "ready", { title: "Depends on root", dependsOn: ["t-a"] }),
      ticket("t-c", "ready", {
        title: "Depends on root too",
        dependsOn: ["t-a"],
      }),
      ticket("t-d", "ready", {
        title: "Depends on b and c",
        dependsOn: ["t-b", "t-c"],
      }),
    ];
    const forward = deriveWayfinderMap(entries);
    const reversed = deriveWayfinderMap([...entries].reverse());
    const forwardPositions = layoutWayfinderMap(forward);
    const reversedPositions = layoutWayfinderMap(reversed);
    assert.equal(forwardPositions.size, reversedPositions.size);
    for (const [id, position] of forwardPositions) {
      assert.deepEqual(reversedPositions.get(id), position);
    }
  });
});

describe("layoutWayfinderMapWarm", () => {
  // A small FlowInstance snapshot: a closed decision, its ready dependent,
  // and (only in the "after" snapshot) one more dependent on the decision
  // plus one unrelated root ticket.
  const before = [
    charting(),
    ticket("t-a", "closed", { title: "Root decision" }),
    ticket("t-b", "ready", { title: "Next step", dependsOn: ["t-a"] }),
  ];
  const after = [
    ...before,
    ticket("t-new", "ready", { title: "Arrives later", dependsOn: ["t-a"] }),
    ticket("t-root2", "ready", { title: "Unrelated root" }),
  ];

  it("returns the previous positions untouched when nothing was added", () => {
    const map = deriveWayfinderMap(before);
    const initial = layoutWayfinderMap(map);
    const warm = layoutWayfinderMapWarm(map, initial);
    assert.equal(warm.size, initial.size);
    for (const [id, position] of initial) {
      assert.deepEqual(warm.get(id), position);
    }
  });

  it("preserves every existing position and places the added nodes", () => {
    const initial = layoutWayfinderMap(deriveWayfinderMap(before));
    const warm = layoutWayfinderMapWarm(deriveWayfinderMap(after), initial);
    assert.equal(warm.size, initial.size + 2);
    for (const [id, position] of initial) {
      assert.deepEqual(warm.get(id), position);
    }
    for (const id of ["t-new", "t-root2"]) {
      const position = warm.get(id);
      assert.ok(position);
      assert.equal(Number.isFinite(position.x), true);
      assert.equal(Number.isFinite(position.y), true);
    }
  });

  it("seeds an added node near its pinned blocker, not at its own far ring", () => {
    const initial = layoutWayfinderMap(deriveWayfinderMap(before));
    const warm = layoutWayfinderMapWarm(deriveWayfinderMap(after), initial);
    const blocker = warm.get("t-a");
    const added = warm.get("t-new");
    assert.ok(blocker && added);
    // t-new's own rank ring (one step deeper than t-a) is far away; having
    // a pinned blocker it must land in the blocker's neighbourhood instead.
    const distanceToBlocker = Math.hypot(
      added.x - blocker.x,
      added.y - blocker.y
    );
    assert.equal(distanceToBlocker < 400, true);
  });

  it("seeds an added unrelated node out at its rank radius", () => {
    const initial = layoutWayfinderMap(deriveWayfinderMap(before));
    const warm = layoutWayfinderMapWarm(deriveWayfinderMap(after), initial);
    const added = warm.get("t-root2");
    assert.ok(added);
    // No pinned neighbour: the node is placed around its own rank ring
    // (rank 0) rather than dropped on top of base camp or the far rim.
    const distanceFromOrigin = Math.hypot(added.x, added.y);
    assert.equal(distanceFromOrigin >= 60, true);
    assert.equal(distanceFromOrigin <= 260, true);
  });
});

describe("wayfinderLayoutBounds", () => {
  it("is undefined for an empty layout", () => {
    assert.equal(wayfinderLayoutBounds(new Map()), undefined);
  });

  it("pads the tight rectangle around every position", () => {
    const positions = new Map([
      ["a", { x: -100, y: 50 }],
      ["b", { x: 300, y: -20 }],
      ["c", { x: 10, y: 400 }],
    ]);
    const bounds = wayfinderLayoutBounds(positions, 70);
    assert.deepEqual(bounds, {
      minX: -170,
      minY: -90,
      maxX: 370,
      maxY: 470,
    });
  });

  it("encloses the full laid-out map", () => {
    const map = deriveWayfinderMap(wayfinderFixtureEntries());
    const positions = layoutWayfinderMap(map);
    const bounds = wayfinderLayoutBounds(positions);
    assert.ok(bounds);
    for (const position of positions.values()) {
      assert.equal(position.x >= bounds.minX, true);
      assert.equal(position.y >= bounds.minY, true);
      assert.equal(position.x <= bounds.maxX, true);
      assert.equal(position.y <= bounds.maxY, true);
    }
  });
});
