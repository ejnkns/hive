import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupInstancesByField } from "./group-by-field.ts";

type TestEntry = {
  id: string;
  state: {
    currentState: string;
    workflowInstanceState: Record<string, unknown>;
  };
};

function entry(
  id: string,
  workflowInstanceState: Record<string, unknown> = {}
): TestEntry {
  return { id, state: { currentState: "imported", workflowInstanceState } };
}

describe("groupInstancesByField (E3)", () => {
  it("partitions instances into one column per distinct field value", () => {
    const grouped = groupInstancesByField("category", [
      entry("a", { category: "infra" }),
      entry("b", { category: "launch" }),
      entry("c", { category: "infra" }),
    ]);
    assert.deepEqual(
      grouped.map((column) => ({
        id: column.id,
        ids: column.entries.map((e) => e.id),
      })),
      [
        { id: "infra", ids: ["a", "c"] },
        { id: "launch", ids: ["b"] },
      ]
    );
  });

  it("sends instances missing the value to an uncategorized column", () => {
    const grouped = groupInstancesByField("category", [
      entry("a", { category: "infra" }),
      entry("b", {}),
      entry("c", { category: "" }),
    ]);
    assert.deepEqual(
      grouped.map((column) => ({
        id: column.id,
        ids: column.entries.map((e) => e.id),
      })),
      [
        { id: "infra", ids: ["a"] },
        { id: "uncategorized", ids: ["b", "c"] },
      ]
    );
  });

  it("omits the uncategorized column when every instance has the value", () => {
    const grouped = groupInstancesByField("category", [
      entry("a", { category: "infra" }),
      entry("b", { category: "launch" }),
    ]);
    assert.equal(
      grouped.some((column) => column.id === "uncategorized"),
      false
    );
  });

  it("renders an empty uncategorized column on an empty board so the workflow stays visible", () => {
    const grouped = groupInstancesByField("category", []);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, "uncategorized");
    assert.equal(grouped[0].entries.length, 0);
  });

  it("treats field values as opaque data — no labels, no ordering, no semantics", () => {
    const grouped = groupInstancesByField("category", [
      entry("a", { category: "zzz" }),
      entry("b", { category: "aaa" }),
    ]);
    // Column ids/labels are the raw values, in first-seen order; nothing
    // sorts or interprets them.
    assert.deepEqual(
      grouped.map((column) => [column.id, column.label]),
      [
        ["zzz", "zzz"],
        ["aaa", "aaa"],
      ]
    );
  });

  it("groups array values by their serialized form (opaque buckets)", () => {
    const grouped = groupInstancesByField("tags", [
      entry("a", { tags: ["x", "y"] }),
      entry("b", { tags: ["x", "y"] }),
      entry("c", { tags: ["z"] }),
    ]);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].entries.map((e) => e.id).join(","), "a,b");
    assert.equal(grouped[1].entries.map((e) => e.id).join(","), "c");
  });

  it("treats non-scalar missing values (null, empty array) as uncategorized", () => {
    const grouped = groupInstancesByField("category", [
      entry("a", { category: null }),
      entry("b", { category: [] }),
      entry("c", { category: "infra" }),
    ]);
    assert.deepEqual(
      grouped.map((column) => ({
        id: column.id,
        ids: column.entries.map((e) => e.id),
      })),
      [
        { id: "infra", ids: ["c"] },
        { id: "uncategorized", ids: ["a", "b"] },
      ]
    );
  });
});
