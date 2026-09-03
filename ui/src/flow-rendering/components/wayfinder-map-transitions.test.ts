// The wayfinder map transitions: the pure diff between two derived map
// snapshots — which node ids arrived (the entrance wave) and which nodes
// changed their derived presentation status (the flare marks). Tested at the
// pure seam (a named export of the wayfinder-map-transitions module,
// imported directly as TypeScript) so live-update feedback is pinned
// independently of the DOM surfaces that consume it. The transition is
// derived UI state — it never rewrites the canonical WorkflowItem state.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import {
  deriveWayfinderMap,
  type WayfinderMap,
} from "../../../../presets/wayfinder/ui/wayfinder-map.ts";
import {
  deriveMapTransitions,
  type WayfinderMapTransitions,
} from "../../../../presets/wayfinder/ui/wayfinder-map-transitions.ts";
import { wayfinderFixtureEntries } from "./wayfinder-fixtures.ts";

// A minimal full WorkflowInstanceEntry for a wayfinder instance (the fields
// the derivation reads are workflowId, currentState, workflowInstanceState,
// and the engine-projected dependency fact).
function instance(
  workflowId: string,
  id: string,
  currentState: string,
  instanceState: Record<string, unknown> = {},
  dependencies: WorkflowInstanceEntry["dependencies"] = {
    blockers: [],
    unsatisfied: [],
  }
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
    dependencies,
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

const charting = () =>
  instance("charting", "c-1", "charted", { destination: "hive router" });

function ticket(
  id: string,
  currentState: string,
  instanceState: Record<string, unknown> = {},
  dependencies: WorkflowInstanceEntry["dependencies"] = {
    blockers: [],
    unsatisfied: [],
  }
): WorkflowInstanceEntry {
  return instance("ticket", id, currentState, instanceState, dependencies);
}

function model(entries: WorkflowInstanceEntry[]): WayfinderMap {
  return deriveWayfinderMap(entries);
}

const EMPTY: WayfinderMapTransitions = {
  addedIds: [],
  statusChanges: [],
};

describe("deriveMapTransitions", () => {
  it("treats the first snapshot as an entrance wave with no status changes", () => {
    const transitions = deriveMapTransitions(undefined, model([charting()]));
    assert.deepEqual([...transitions.addedIds].sort(), ["base", "summit"]);
    assert.deepEqual(transitions.statusChanges, []);
  });

  it("reports nothing for the same snapshot again", () => {
    const entries = [charting(), ticket("t-1", "fog")];
    const transitions = deriveMapTransitions(
      model(entries),
      model(structuredClone(entries))
    );
    assert.deepEqual(transitions, EMPTY);
  });

  it("reports only the newly arrived node ids, never the survivors", () => {
    const before = model([charting(), ticket("t-1", "fog")]);
    const after = model([
      charting(),
      ticket("t-1", "fog"),
      ticket("t-2", "closed", { title: "Root decision" }),
    ]);
    const transitions = deriveMapTransitions(before, after);
    assert.deepEqual(transitions.addedIds, ["t-2"]);
    assert.deepEqual(transitions.statusChanges, []);
  });

  it("reports a presentation change with its from and to statuses", () => {
    const before = model([
      charting(),
      ticket("t-1", "resolving_research", { title: "Grill the seam" }),
    ]);
    const after = model([
      charting(),
      ticket("t-1", "closed", { title: "Grill the seam" }),
    ]);
    const transitions = deriveMapTransitions(before, after);
    assert.deepEqual(transitions.addedIds, []);
    assert.deepEqual(transitions.statusChanges, [
      { id: "t-1", from: "active", to: "decision" },
    ]);
  });

  it("marks a ready ticket whose last blocker closed as frontier (the blocked -> frontier face change)", () => {
    // Before: both tickets ready, the engine projects the blocker as
    // unsatisfied — the dependent presents as blocked. After: the blocker
    // closed and the engine re-projects the dependency fact (the satisfying
    // state is the engine's decision, not a UI re-derivation) — the same
    // ticket now presents as the actionable frontier. The transitions seam
    // diffs the derived model unchanged; the face change simply became
    // engine-truth-driven.
    const before = model([
      charting(),
      ticket("t-0", "ready", { title: "Root decision" }),
      ticket(
        "t-2",
        "ready",
        { title: "Next step", dependsOn: ["t-0"] },
        { blockers: ["t-0"], unsatisfied: ["t-0"] }
      ),
    ]);
    const after = model([
      charting(),
      ticket("t-0", "closed", { title: "Root decision" }),
      ticket(
        "t-2",
        "ready",
        { title: "Next step", dependsOn: ["t-0"] },
        { blockers: ["t-0"], unsatisfied: [] }
      ),
    ]);
    const transitions = deriveMapTransitions(before, after);
    assert.deepEqual(transitions.addedIds, []);
    assert.deepEqual(transitions.statusChanges, [
      { id: "t-2", from: "blocked", to: "frontier" },
      { id: "t-0", from: "frontier", to: "decision" },
    ]);
  });

  it("does not flare a node whose title or meta changed but whose presentation held", () => {
    const before = model([charting(), ticket("t-1", "fog")]);
    const after = model([
      charting(),
      ticket("t-1", "fog", { brief: "A sharper question" }),
    ]);
    const transitions = deriveMapTransitions(before, after);
    assert.deepEqual(transitions, EMPTY);
  });

  it("neither adds nor flares a node that disappeared from the snapshot", () => {
    const before = model([charting(), ticket("t-1", "fog")]);
    const after = model([charting()]);
    const transitions = deriveMapTransitions(before, after);
    assert.deepEqual(transitions, EMPTY);
  });

  it("reads a live update from the baseline fixture without noise", () => {
    const baseline = model(wayfinderFixtureEntries());
    const laterEntries = wayfinderFixtureEntries();
    const frontier = laterEntries.find(
      (entry) => entry.id === "ticket-frontier"
    );
    if (frontier !== undefined) {
      frontier.state.currentState = "resolving_research";
    }
    const transitions = deriveMapTransitions(baseline, model(laterEntries));
    assert.deepEqual(transitions, {
      addedIds: [],
      statusChanges: [
        { id: "ticket-frontier", from: "frontier", to: "active" },
      ],
    });
  });
});
