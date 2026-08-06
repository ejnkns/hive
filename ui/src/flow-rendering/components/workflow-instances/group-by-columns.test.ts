import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupInstancesByColumns } from "./group-by-columns";

const states = [
  { id: "fog", label: "Fog", category: "initial" as const },
  { id: "ready", label: "Ready", category: "active" as const },
  {
    id: "resolving_research",
    label: "Resolving — research",
    category: "active" as const,
  },
  { id: "closed", label: "Closed", category: "terminal" as const },
];

const columns = [
  { id: "fog", label: "Fog", states: ["fog"] },
  { id: "frontier", label: "Frontier", states: ["ready"] },
  { id: "resolving", label: "Resolving", states: ["resolving_research"] },
  { id: "closed", label: "Closed", states: ["closed"] },
];

type TestEntry = { id: string; state: { currentState: string } };

function entry(id: string, currentState: string): TestEntry {
  return { id, state: { currentState } };
}

describe("groupInstancesByColumns", () => {
  it("orders columns by the declared declaration, not by instance arrival", () => {
    const grouped = groupInstancesByColumns(states, columns, [
      entry("c", "closed"),
      entry("f", "fog"),
      entry("r", "ready"),
    ]);
    assert.deepEqual(
      grouped.map((column) => column.id),
      ["fog", "frontier", "resolving", "closed"]
    );
  });

  it("folds member states into their curated column", () => {
    const grouped = groupInstancesByColumns(
      [
        ...states,
        { id: "validating", label: "Validating", category: "active" as const },
      ],
      [
        {
          id: "in_progress",
          label: "In Progress",
          states: ["ready", "validating"],
        },
        { id: "closed", label: "Closed", states: ["closed"] },
      ],
      [entry("a", "ready"), entry("b", "validating"), entry("c", "closed")]
    );
    assert.equal(grouped[0].entries.map((e) => e.id).join(","), "a,b");
    assert.equal(grouped[1].entries.map((e) => e.id).join(","), "c");
  });

  it("keeps entries whose state no column lists in a trailing Other column", () => {
    const grouped = groupInstancesByColumns(
      [
        ...states,
        { id: "recording", label: "Recording", category: "active" as const },
      ],
      [{ id: "closed", label: "Closed", states: ["closed"] }],
      [entry("a", "recording"), entry("b", "closed")]
    );
    assert.deepEqual(
      grouped.map((column) => column.id),
      ["closed", "other"]
    );
    assert.equal(grouped[1].label, "Other");
    assert.equal(grouped[1].entries.map((e) => e.id).join(","), "a");
  });

  it("renders an empty Other column when a state is uncurated but has no instances", () => {
    const grouped = groupInstancesByColumns(
      [...states, { id: "recording", label: "Recording" }],
      [{ id: "closed", label: "Closed", states: ["closed"] }],
      [entry("b", "closed")]
    );
    assert.deepEqual(
      grouped.map((column) => column.id),
      ["closed", "other"]
    );
    assert.equal(grouped[1].entries.length, 0);
  });

  it("omits the Other column when every state is curated", () => {
    const grouped = groupInstancesByColumns(
      states,
      [
        { id: "fog", label: "Fog", states: ["fog"] },
        { id: "frontier", label: "Frontier", states: ["ready"] },
        { id: "resolving", label: "Resolving", states: ["resolving_research"] },
        { id: "closed", label: "Closed", states: ["closed"] },
      ],
      [entry("b", "closed")]
    );
    assert.deepEqual(
      grouped.map((column) => column.id),
      ["fog", "frontier", "resolving", "closed"]
    );
  });

  it("carries the declared label and derives the category from the first member state", () => {
    const grouped = groupInstancesByColumns(states, columns, [
      entry("a", "fog"),
    ]);
    assert.equal(grouped[0].label, "Fog");
    assert.equal(grouped[0].category, "initial");
    assert.equal(grouped[1].category, "active");
    assert.equal(grouped[3].category, "terminal");
  });

  it("defaults a category to active when no member state carries one", () => {
    const grouped = groupInstancesByColumns(
      [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      [{ id: "lane", label: "Lane", states: ["x", "y"] }],
      [entry("a", "x")]
    );
    assert.equal(grouped[0].category, "active");
  });
});
