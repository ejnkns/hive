import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupInstancesByState } from "./group-by-state";

const states = [
  { id: "fog", label: "Fog", category: "initial" as const },
  { id: "ready", label: "Ready", category: "active" as const },
  { id: "resolving", label: "Resolving", category: "active" as const },
  { id: "closed", label: "Closed", category: "terminal" as const },
];

type TestEntry = { id: string; state: { currentState: string } };

function entry(id: string, currentState: string): TestEntry {
  return { id, state: { currentState } };
}

describe("groupInstancesByState", () => {
  it("orders columns by the declared states, not by instance arrival", () => {
    const columns = groupInstancesByState(states, [
      entry("c", "closed"),
      entry("f", "fog"),
      entry("r", "ready"),
    ]);
    assert.deepEqual(
      columns.map((column) => column.id),
      ["fog", "ready", "resolving", "closed"]
    );
  });

  it("places each instance in its current-state column", () => {
    const columns = groupInstancesByState(states, [
      entry("a", "fog"),
      entry("b", "ready"),
      entry("c", "ready"),
    ]);
    assert.equal(columns[0].entries.map((e) => e.id).join(","), "a");
    assert.equal(columns[1].entries.map((e) => e.id).join(","), "b,c");
    assert.equal(columns[2].entries.length, 0);
  });

  it("carries the state label and category through to the column", () => {
    const columns = groupInstancesByState(states, [entry("a", "closed")]);
    assert.equal(columns[3].label, "Closed");
    assert.equal(columns[3].category, "terminal");
    assert.equal(columns[3].entries.length, 1);
  });

  it("defaults a missing category to active", () => {
    const columns = groupInstancesByState(
      [{ id: "x", label: "X" }],
      [entry("a", "x")]
    );
    assert.equal(columns[0].category, "active");
  });
});
