// The wayfinder map derivation: entries -> a dependency-aware presentation
// model — nodes (stable ids, derived presentation status, blocker/dependent
// adjacency), directed dependency edges, sidebar groups, the destination,
// and derived counts. Tested at the pure seam (a named export of the
// wayfinder-map module, imported directly as TypeScript) rather than through
// the DOM, so status classification and dependency semantics have
// deterministic coverage before any SVG is drawn.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import {
  deriveWayfinderMap,
  wayfinderGroupOf,
} from "../../../../presets/wayfinder/ui/wayfinder-map.ts";
import { wayfinderFixtureEntries } from "./wayfinder-fixtures.ts";

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

function ticket(
  id: string,
  state: string,
  instanceState: Record<string, unknown> = {}
): WorkflowInstanceEntry {
  return instance("ticket", id, state, instanceState);
}

describe("deriveWayfinderMap", () => {
  it("derives every presentation status from ticket state", () => {
    const entries = [
      charting(),
      ticket("t-1", "fog", { brief: "metrics to Effect?" }),
      ticket("t-2", "ready", {
        title: "Pick the router",
        type: "research",
        dependsOn: ["t-5"],
      }),
      ticket("t-3", "ready", {
        title: "Prototype sync",
        type: "prototype",
        dependsOn: ["t-1"],
      }),
      ticket("t-4", "resolving_research", {
        title: "Grill the interop seam",
        type: "grilling",
      }),
      ticket("t-5", "closed", {
        title: "Pilot is concurrency-first",
        type: "research",
      }),
      ticket("t-6", "out_of_scope", {
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

    const byStatus = groupBy(map.nodes, (n) => n.presentation);
    assert.deepEqual(
      byStatus.get("base")?.map((n) => n.instanceId),
      ["c-1"]
    );
    assert.deepEqual(
      byStatus.get("summit")?.map((n) => n.title),
      ["hive router"]
    );
    // Fog is the most actionable thing — always present, never dropped.
    assert.deepEqual(
      byStatus.get("fog")?.map((n) => n.id),
      ["t-1"]
    );
    // A ready ticket whose blockers are all closed is the actionable
    // frontier; a ready ticket with an unresolved blocker is blocked. They
    // are distinct presentation statuses — never a plain "ready".
    assert.deepEqual(
      byStatus.get("frontier")?.map((n) => n.id),
      ["t-2"]
    );
    assert.deepEqual(
      byStatus.get("blocked")?.map((n) => n.id),
      ["t-3"]
    );
    assert.ok(!statusesOf(map).has("ready"), "no plain ready status");
    // Resolving/recording tickets present as active, not as their raw state.
    assert.deepEqual(
      byStatus.get("active")?.map((n) => n.id),
      ["t-4"]
    );
    assert.ok(!statusesOf(map).has("resolving"), "no plain resolving status");
    // Closed tickets become decisions; out-of-scope stays separate.
    assert.deepEqual(
      byStatus.get("decision")?.map((n) => n.id),
      ["t-5"]
    );
    assert.deepEqual(
      byStatus.get("out-of-scope")?.map((n) => n.id),
      ["t-6"]
    );
    // build + buildItem are the implementation milestones.
    assert.deepEqual(
      byStatus.get("implementation")?.map((n) => n.id),
      ["b-1", "bi-1"]
    );
  });

  it("classifies ready as frontier only when every dependsOn blocker is closed", () => {
    const map = deriveWayfinderMap([
      charting(),
      ticket("decision-1", "closed"),
      ticket("fog-1", "fog"),
      ticket("ready-clear", "ready", { dependsOn: ["decision-1"] }),
      ticket("ready-open", "ready", { dependsOn: ["fog-1"] }),
      ticket("ready-none", "ready"),
    ]);
    const presentation = (id: string) =>
      map.nodes.find((node) => node.id === id)?.presentation;
    assert.equal(presentation("ready-clear"), "frontier");
    assert.equal(presentation("ready-open"), "blocked");
    // No dependsOn at all -> no unresolved blockers -> frontier.
    assert.equal(presentation("ready-none"), "frontier");
  });

  it("maps resolving and recording to active, closed to decision, out_of_scope to out-of-scope", () => {
    const map = deriveWayfinderMap([
      charting(),
      ticket("t-1", "resolving_grilling"),
      ticket("t-2", "recording"),
      ticket("t-3", "resolving_task_hitl"),
      ticket("t-4", "closed"),
      ticket("t-5", "out_of_scope"),
    ]);
    const presentation = (id: string) =>
      map.nodes.find((node) => node.id === id)?.presentation;
    assert.equal(presentation("t-1"), "active");
    assert.equal(presentation("t-2"), "active");
    assert.equal(presentation("t-3"), "active");
    assert.equal(presentation("t-4"), "decision");
    assert.equal(presentation("t-5"), "out-of-scope");
  });

  it("maps every build and buildItem record to implementation regardless of its state", () => {
    const map = deriveWayfinderMap([
      charting(),
      instance("build", "b-1", "specing"),
      instance("build", "b-2", "accepted"),
      instance("buildItem", "bi-1", "working"),
      instance("buildItem", "bi-2", "done"),
    ]);
    const implementation = map.nodes
      .filter((node) => node.presentation === "implementation")
      .map((node) => node.id);
    assert.deepEqual(implementation, ["b-1", "b-2", "bi-1", "bi-2"]);
  });

  describe("dependency edges", () => {
    it("runs each edge from its blocker to the dependent", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("fog-1", "fog"),
        ticket("ready-1", "ready", { dependsOn: ["fog-1"] }),
      ]);
      assert.deepEqual(map.edges, [
        {
          id: "fog-1->ready-1",
          from: "fog-1",
          to: "ready-1",
          satisfied: false,
        },
      ]);
    });

    it("marks an edge satisfied only when the blocker ticket is closed", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("decision-1", "closed"),
        ticket("fog-1", "fog"),
        ticket("frontier-1", "ready", { dependsOn: ["decision-1"] }),
        ticket("blocked-1", "ready", { dependsOn: ["fog-1"] }),
      ]);
      assert.deepEqual(
        map.edges.filter((edge) => edge.satisfied).map((edge) => edge.id),
        ["decision-1->frontier-1"]
      );
      assert.deepEqual(
        map.edges.filter((edge) => !edge.satisfied).map((edge) => edge.id),
        ["fog-1->blocked-1"]
      );
    });

    it("does not let an out-of-scope blocker satisfy a dependency", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("oos-1", "out_of_scope"),
        ticket("ready-1", "ready", { dependsOn: ["oos-1"] }),
      ]);
      const edge = map.edges.find((candidate) => candidate.to === "ready-1");
      assert.equal(edge?.satisfied, false);
      assert.equal(
        map.nodes.find((node) => node.id === "ready-1")?.presentation,
        "blocked"
      );
    });

    it("keeps a dangling dependsOn reference as an unsatisfied edge and blocks its dependent", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("ready-1", "ready", { dependsOn: ["missing-ticket"] }),
      ]);
      assert.deepEqual(
        map.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          satisfied: edge.satisfied,
        })),
        [{ from: "missing-ticket", to: "ready-1", satisfied: false }]
      );
      assert.equal(
        map.nodes.find((node) => node.id === "ready-1")?.presentation,
        "blocked"
      );
    });

    it("never invents edges where the snapshot declares no relationship", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("fog-1", "fog"),
        ticket("ready-1", "ready"),
        instance("buildItem", "bi-1", "working", { dependsOn: [] }),
      ]);
      assert.deepEqual(map.edges, []);
    });
  });

  describe("reverse dependents", () => {
    it("lists the dependents of a node on the node itself (for the detail drawer)", () => {
      const map = deriveWayfinderMap(wayfinderFixtureEntries());
      const byId = new Map(map.nodes.map((node) => [node.id, node]));
      assert.deepEqual(byId.get("ticket-fog")?.dependents, ["ticket-blocked"]);
      assert.deepEqual(byId.get("ticket-decision")?.dependents, [
        "ticket-frontier",
      ]);
      assert.deepEqual(byId.get("ticket-blocked")?.blockers, ["ticket-fog"]);
      assert.deepEqual(byId.get("ticket-frontier")?.blockers, [
        "ticket-decision",
      ]);
      assert.deepEqual(byId.get("base")?.dependents, []);
    });
  });

  describe("defensive handling", () => {
    it("treats a missing or malformed dependsOn as no blockers", () => {
      const map = deriveWayfinderMap([
        charting(),
        ticket("t-1", "ready", { dependsOn: "not-an-array" }),
        ticket("t-2", "ready", { dependsOn: [42, "t-3"] }),
        ticket("t-3", "fog"),
      ]);
      assert.equal(
        map.nodes.find((node) => node.id === "t-1")?.presentation,
        "frontier"
      );
      // Non-string entries are ignored; the string reference still blocks.
      assert.equal(
        map.nodes.find((node) => node.id === "t-2")?.presentation,
        "blocked"
      );
      assert.deepEqual(
        map.edges.map((edge) => edge.from),
        ["t-3"]
      );
    });
  });

  describe("derived counts", () => {
    it("counts the fixture's content nodes per presentation status", () => {
      const map = deriveWayfinderMap(wayfinderFixtureEntries());
      assert.deepEqual(map.counts, {
        fog: 1,
        frontier: 1,
        blocked: 1,
        active: 1,
        decision: 1,
        "out-of-scope": 1,
        implementation: 2,
      });
    });

    it("reports zero counts for an empty expedition", () => {
      const map = deriveWayfinderMap([charting()]);
      assert.deepEqual(map.counts, {
        fog: 0,
        frontier: 0,
        blocked: 0,
        active: 0,
        decision: 0,
        "out-of-scope": 0,
        implementation: 0,
      });
    });
  });

  describe("groups", () => {
    it("groups the fixture by station, with blocked separate from frontier", () => {
      const map = deriveWayfinderMap(wayfinderFixtureEntries());
      const groupNodes = (id: string) =>
        map.groups
          .find((group) => group.id === id)
          ?.nodes.map((node) => node.id);
      assert.deepEqual(groupNodes("base"), ["base"]);
      assert.deepEqual(groupNodes("fog"), ["ticket-fog"]);
      assert.deepEqual(groupNodes("frontier"), ["ticket-frontier"]);
      assert.deepEqual(groupNodes("blocked"), ["ticket-blocked"]);
      assert.deepEqual(groupNodes("ascent"), [
        "ticket-resolving",
        "ticket-decision",
        "build-1",
        "build-item-1",
      ]);
      assert.deepEqual(groupNodes("out-of-scope"), ["ticket-out-of-scope"]);
      assert.deepEqual(groupNodes("summit"), ["summit"]);
    });

    it("wayfinderGroupOf maps each presentation status to its station", () => {
      assert.equal(wayfinderGroupOf("base"), "base");
      assert.equal(wayfinderGroupOf("fog"), "fog");
      assert.equal(wayfinderGroupOf("frontier"), "frontier");
      assert.equal(wayfinderGroupOf("blocked"), "blocked");
      assert.equal(wayfinderGroupOf("active"), "ascent");
      assert.equal(wayfinderGroupOf("decision"), "ascent");
      assert.equal(wayfinderGroupOf("implementation"), "ascent");
      assert.equal(wayfinderGroupOf("out-of-scope"), "out-of-scope");
      assert.equal(wayfinderGroupOf("summit"), "summit");
    });
  });

  it("keeps stable node identity from the workflow snapshot (never array indexes)", () => {
    const fog = [1, 2, 3, 4].map((n) => ticket(`fog-${n}`, "fog"));
    const map = deriveWayfinderMap([charting(), ...fog]);
    const ids = map.nodes.map((node) => node.id).sort();
    assert.deepEqual(ids, [
      "base",
      "fog-1",
      "fog-2",
      "fog-3",
      "fog-4",
      "summit",
    ]);
    for (const node of map.nodes) {
      assert.ok(!/^\d+$/.test(node.id), `${node.id} is not an index`);
    }
    for (const edge of map.edges) {
      assert.equal(typeof edge.from, "string");
      assert.equal(typeof edge.to, "string");
    }
  });

  it("renders an empty expedition as base camp + the destination only", () => {
    const map = deriveWayfinderMap([charting()]);
    assert.deepEqual(map.nodes.map((node) => node.presentation).sort(), [
      "base",
      "summit",
    ]);
    assert.equal(map.destination, "hive router");
    assert.deepEqual(map.edges, []);
  });

  it("places the summit above and right of the base camp, within bounds", () => {
    const map = deriveWayfinderMap([
      charting(),
      ticket("t-1", "fog"),
      ticket("t-2", "ready"),
      ticket("t-3", "closed"),
    ]);
    const summit = map.nodes.find((node) => node.presentation === "summit");
    const base = map.nodes.find((node) => node.presentation === "base");
    assert.ok(summit && base);
    assert.ok(summit.x > base.x, "summit sits right of base camp");
    assert.ok(summit.y < base.y, "summit sits above base camp");
    for (const node of map.nodes) {
      assert.ok(node.x >= 0 && node.x <= 100, `${node.id} x in bounds`);
      assert.ok(node.y >= 0 && node.y <= 100, `${node.id} y in bounds`);
    }
  });

  it("is deterministic (same input -> same positions, edges, and counts)", () => {
    const entries = [
      charting(),
      ticket("t-1", "fog"),
      ticket("t-2", "ready", { dependsOn: ["t-1"] }),
      ticket("t-3", "ready", { dependsOn: ["t-5"] }),
      ticket("t-4", "resolving_research"),
      ticket("t-5", "closed"),
    ];
    assert.deepEqual(deriveWayfinderMap(entries), deriveWayfinderMap(entries));
  });

  // The shared baseline fixture (wayfinder-fixtures.ts): one WorkflowItem per
  // lifecycle position. Ticket 01 pinned the CURRENT derivation as the
  // compatibility baseline; this ticket closes its recorded blocked/frontier
  // gap on top of that data contract (dependsOn was already on the WorkflowItem
  // state — no domain field is missing).
  describe("the shared wayfinder baseline fixture", () => {
    it("places every lifecycle record in its baseline group", () => {
      const map = deriveWayfinderMap(wayfinderFixtureEntries());

      assert.equal(map.destination, "Hive router resilience");

      const byStatus = groupBy(map.nodes, (n) => n.presentation);
      assert.deepEqual(
        byStatus.get("fog")?.map((n) => n.id),
        ["ticket-fog"]
      );
      // The recorded baseline gap is closed: the ready ticket whose blocker
      // (ticket-fog) is not closed presents as blocked; the ready ticket whose
      // blocker (ticket-decision) is closed presents as the actionable
      // frontier. No plain "ready" status remains.
      assert.deepEqual(
        byStatus.get("frontier")?.map((n) => n.id),
        ["ticket-frontier"]
      );
      assert.deepEqual(
        byStatus.get("blocked")?.map((n) => n.id),
        ["ticket-blocked"]
      );
      assert.deepEqual(
        byStatus.get("active")?.map((n) => n.id),
        ["ticket-resolving"]
      );
      assert.deepEqual(
        byStatus.get("decision")?.map((n) => n.id),
        ["ticket-decision"]
      );
      assert.deepEqual(
        byStatus.get("out-of-scope")?.map((n) => n.id),
        ["ticket-out-of-scope"]
      );
      assert.deepEqual(
        byStatus.get("implementation")?.map((n) => n.id),
        ["build-1", "build-item-1"]
      );
      assert.deepEqual(
        byStatus.get("base")?.map((n) => n.instanceId),
        ["charting-1"]
      );
      assert.deepEqual(
        byStatus.get("summit")?.map((n) => n.title),
        ["Hive router resilience"]
      );
    });

    it("orders the fixture's ascent active -> decision -> build -> build item", () => {
      const map = deriveWayfinderMap(wayfinderFixtureEntries());
      const ascent = map.groups
        .find((group) => group.id === "ascent")
        ?.nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      assert.deepEqual(
        ascent?.map((node) => node.id),
        ["ticket-resolving", "ticket-decision", "build-1", "build-item-1"]
      );
    });

    it("carries dependsOn on the fixture's WorkflowItem state for the blocked/frontier split", () => {
      const entries = wayfinderFixtureEntries();
      const blocked = entries.find((entry) => entry.id === "ticket-blocked");
      const frontier = entries.find((entry) => entry.id === "ticket-frontier");
      assert.deepEqual(blocked?.state.workflowInstanceState.dependsOn, [
        "ticket-fog",
      ]);
      assert.deepEqual(frontier?.state.workflowInstanceState.dependsOn, [
        "ticket-decision",
      ]);
    });

    it("derives the same map from the same fixture order (deterministic)", () => {
      assert.deepEqual(
        deriveWayfinderMap(wayfinderFixtureEntries()),
        deriveWayfinderMap(wayfinderFixtureEntries())
      );
    });
  });

  it("orders the ascent path active -> decisions -> implementations -> summit", () => {
    const entries = [
      charting(),
      ticket("t-4", "resolving_research"),
      ticket("t-5", "closed"),
      instance("buildItem", "bi-1", "done"),
      instance("build", "b-1", "accepted"),
    ];
    const map = deriveWayfinderMap(entries);
    const ascent = map.groups
      .find((group) => group.id === "ascent")
      ?.nodes.filter((node) => node.order !== undefined)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    assert.deepEqual(
      ascent?.map((node) => node.presentation),
      ["active", "decision", "implementation", "implementation"]
    );
    // The summit follows the ascent's last node.
    const ordered = [
      ...(ascent ?? []),
      map.nodes.find((node) => node.presentation === "summit"),
    ];
    assert.equal(ordered[ordered.length - 1]?.presentation, "summit");
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

// The presentation statuses actually present in a map — used to prove a
// status is absent without typing a Map lookup with an invalid key.
function statusesOf(map: ReturnType<typeof deriveWayfinderMap>): Set<string> {
  return new Set(map.nodes.map((node) => node.presentation));
}
