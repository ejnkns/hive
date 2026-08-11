import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowHistoryEntry } from "workflow-engine/workflow-types";
import { statePath } from "./state-path.ts";

function transition(fromState: string, toState: string): WorkflowHistoryEntry {
  return {
    type: "state_transition",
    fromState,
    toState,
    timestamp: new Date().toISOString(),
  };
}

describe("statePath", () => {
  it("derives the visited states in order from transitions", () => {
    const path = statePath(
      [
        transition("ready", "working"),
        transition("working", "reviewing"),
        transition("reviewing", "done"),
      ],
      "done"
    );
    assert.deepEqual(path, ["ready", "working", "reviewing", "done"]);
  });

  it("dedupes revisited states, keeping the first visit", () => {
    const path = statePath(
      [transition("ready", "working"), transition("working", "ready")],
      "ready"
    );
    assert.deepEqual(path, ["ready", "working"]);
  });

  it("appends the current state when it has no transition yet", () => {
    const path = statePath([transition("ready", "working")], "working");
    assert.deepEqual(path, ["ready", "working"]);
  });

  it("returns just the current state for a fresh instance", () => {
    assert.deepEqual(statePath([], "fog"), ["fog"]);
  });
});
