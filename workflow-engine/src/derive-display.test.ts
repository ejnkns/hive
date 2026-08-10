import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveDisplayValue } from "./derive-display";
import type { DerivedDisplay } from "./workflow-types";

const items = [
  { status: "done", cost: 3 },
  { status: "done", cost: 2 },
  { status: "pending", cost: 5 },
];

describe("deriveDisplayValue", () => {
  it("counts array length without a where clause", () => {
    assert.deepEqual(deriveDisplayValue({ kind: "count" }, items), {
      kind: "count",
      value: 3,
    });
  });

  it("counts only items matching a where clause", () => {
    const derive: DerivedDisplay = {
      kind: "count",
      where: { field: "status", equals: "done" },
    };
    assert.deepEqual(deriveDisplayValue(derive, items), {
      kind: "count",
      value: 2,
    });
  });

  it("computes progress as matched over total", () => {
    const derive: DerivedDisplay = {
      kind: "progress",
      where: { field: "status", equals: "done" },
    };
    assert.deepEqual(deriveDisplayValue(derive, items), {
      kind: "progress",
      count: 2,
      total: 3,
    });
  });

  it("matches only strict equality", () => {
    const derive: DerivedDisplay = {
      kind: "count",
      where: { field: "status", equals: "DONE" },
    };
    assert.deepEqual(deriveDisplayValue(derive, items), {
      kind: "count",
      value: 0,
    });
  });

  it("ignores non-object items when matching", () => {
    assert.deepEqual(
      deriveDisplayValue(
        { kind: "count", where: { field: "status", equals: "done" } },
        [{ status: "done" }, "not-an-object", null, 5]
      ),
      { kind: "count", value: 1 }
    );
  });

  it("sums an array of numbers", () => {
    assert.deepEqual(deriveDisplayValue({ kind: "sum" }, [1, 2, 3]), {
      kind: "sum",
      value: 6,
    });
  });

  it("sums a numeric item field, skipping non-matching items", () => {
    assert.deepEqual(
      deriveDisplayValue({ kind: "sum", field: "cost" }, items),
      {
        kind: "sum",
        value: 10,
      }
    );
  });

  it("returns undefined for a non-array source", () => {
    assert.equal(deriveDisplayValue({ kind: "count" }, "nope"), undefined);
    assert.equal(deriveDisplayValue({ kind: "count" }, 5), undefined);
    assert.equal(deriveDisplayValue({ kind: "count" }, null), undefined);
    assert.equal(deriveDisplayValue({ kind: "sum" }, {}), undefined);
  });

  it("returns undefined when a sum has no numeric items", () => {
    assert.equal(
      deriveDisplayValue({ kind: "sum", field: "cost" }, [{ status: "x" }]),
      undefined
    );
    assert.equal(deriveDisplayValue({ kind: "sum" }, ["a", "b"]), undefined);
  });
});
