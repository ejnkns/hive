// The wayfinder map derivation: entries -> nodes/groups/positions — the pure
// core both the table view and the map view render from. Tested at the pure
// seam (a named export of the wayfinder-map module, imported directly as
// TypeScript) rather than through the DOM, so the group-membership logic has
// deterministic coverage before any SVG is drawn.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import { deriveWayfinderMap } from "../../../../presets/wayfinder/ui/wayfinder-map.ts";

// A minimal full WorkflowInstanceEntry for a wayfinder instance (the fields the
// derivation reads are workflowId, currentState, and workflowInstanceState).
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
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

const charting = () =>
  instance("charting", "c-1", "charted", {
    destination: "hive router",
    notes: "offline-first",
  });

describe("deriveWayfinderMap", () => {
  it("derives every group and node kind from ticket state", () => {
    const entries = [
      charting(),
      instance("ticket", "t-1", "fog", { brief: "metrics to Effect?" }),
      instance("ticket", "t-2", "ready", {
        title: "Pick the router",
        type: "research",
      }),
      instance("ticket", "t-3", "ready", {
        title: "Prototype sync",
        type: "prototype",
      }),
      instance("ticket", "t-4", "resolving_research", {
        title: "Grill the interop seam",
        type: "grilling",
      }),
      instance("ticket", "t-5", "closed", {
        title: "Pilot is concurrency-first",
        type: "research",
      }),
      instance("ticket", "t-6", "out_of_scope", {
        title: "Carve-out audit",
        type: "task",
      }),
      instance("build", "b-1", "accepted"),
      instance("buildItem", "bi-1", "done", {
        ticket: { title: "Retry loop" },
      }),
    ];
    const map = deriveWayfinderMap(entries);

    assert.equal(map.destination, "hive router");

    const byKind = groupBy(map.nodes, (n) => n.kind);
    assert.deepEqual(
      byKind.get("base")?.map((n) => n.instanceId),
      ["c-1"]
    );
    assert.deepEqual(
      byKind.get("summit")?.map((n) => n.title),
      ["hive router"]
    );
    // Fog is the most actionable thing — always present, never dropped.
    assert.deepEqual(
      byKind.get("fog")?.map((n) => n.instanceId),
      ["t-1"]
    );
    // Ready tickets line the frontier.
    assert.deepEqual(
      byKind.get("ready")?.map((n) => n.instanceId),
      ["t-2", "t-3"]
    );
    assert.deepEqual(
      byKind.get("resolving")?.map((n) => n.instanceId),
      ["t-4"]
    );
    // Closed tickets become decisions; out-of-scope stays separate.
    assert.deepEqual(
      byKind.get("decision")?.map((n) => n.instanceId),
      ["t-5"]
    );
    assert.deepEqual(
      byKind.get("out-of-scope")?.map((n) => n.instanceId),
      ["t-6"]
    );
    // build + buildItem are the implementation milestones.
    assert.deepEqual(
      byKind.get("implementation")?.map((n) => n.instanceId),
      ["b-1", "bi-1"]
    );

    // The sidebar groups carry the same membership.
    const fogGroup = map.groups.find((g) => g.id === "fog");
    assert.deepEqual(
      fogGroup?.nodes.map((n) => n.instanceId),
      ["t-1"]
    );
    const ascent = map.groups.find((g) => g.id === "ascent");
    assert.deepEqual(
      ascent?.nodes.map((n) => n.instanceId),
      ["t-4", "t-5", "b-1", "bi-1"]
    );
  });

  it("renders an empty expedition as base camp + the destination only", () => {
    const map = deriveWayfinderMap([charting()]);
    assert.deepEqual(map.nodes.map((n) => n.kind).sort(), ["base", "summit"]);
    assert.equal(map.destination, "hive router");
  });

  it("places the summit above and right of the base camp, within bounds", () => {
    const map = deriveWayfinderMap([
      charting(),
      instance("ticket", "t-1", "fog"),
      instance("ticket", "t-2", "ready"),
      instance("ticket", "t-3", "closed"),
    ]);
    const summit = map.nodes.find((n) => n.kind === "summit");
    const base = map.nodes.find((n) => n.kind === "base");
    assert.ok(summit && base);
    assert.ok(summit.x > base.x, "summit sits right of base camp");
    assert.ok(summit.y < base.y, "summit sits above base camp");
    for (const node of map.nodes) {
      assert.ok(node.x >= 0 && node.x <= 100, `${node.id} x in bounds`);
      assert.ok(node.y >= 0 && node.y <= 100, `${node.id} y in bounds`);
    }
  });

  it("is deterministic (same input -> same positions)", () => {
    const entries = [
      charting(),
      instance("ticket", "t-1", "fog"),
      instance("ticket", "t-2", "ready"),
      instance("ticket", "t-3", "closed"),
    ];
    assert.deepEqual(deriveWayfinderMap(entries), deriveWayfinderMap(entries));
  });

  it("orders the ascent path resolving -> decisions -> implementations -> summit", () => {
    const entries = [
      charting(),
      instance("ticket", "t-4", "resolving_research"),
      instance("ticket", "t-5", "closed"),
      instance("buildItem", "bi-1", "done"),
      instance("build", "b-1", "accepted"),
    ];
    const map = deriveWayfinderMap(entries);
    const ascent = map.groups
      .find((g) => g.id === "ascent")
      ?.nodes.filter((n) => n.order !== undefined)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    assert.deepEqual(
      ascent?.map((n) => n.kind),
      ["resolving", "decision", "implementation", "implementation"]
    );
    // The summit follows the ascent's last node.
    const ordered = [
      ...(ascent ?? []),
      map.nodes.find((n) => n.kind === "summit"),
    ];
    assert.equal(ordered[ordered.length - 1]?.kind, "summit");
  });
});

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = result.get(k) ?? [];
    list.push(item);
    result.set(k, list);
  }
  return result;
}
