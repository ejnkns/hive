import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveAcrossDisplayValue,
  deriveDisplayValue,
  summarizeWorkflowInstances,
} from "./derive-display.ts";
import type { DerivedDisplay } from "./workflow-types.ts";

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

describe("summarizeWorkflowInstances", () => {
  it("counts total instances and per scalar field values", () => {
    const summary = summarizeWorkflowInstances([
      { workflowInstanceState: { status: "pending", kind: "bug" } },
      { workflowInstanceState: { status: "done", kind: "bug" } },
      { workflowInstanceState: { status: "done", kind: "feat" } },
      { workflowInstanceState: {} },
    ]);
    assert.deepEqual(summary, {
      total: 4,
      byField: {
        status: { pending: 1, done: 2 },
        kind: { bug: 2, feat: 1 },
      },
    });
  });

  it("skips non-scalar fields (arrays and objects)", () => {
    const summary = summarizeWorkflowInstances([
      {
        workflowInstanceState: {
          status: "done",
          items: [1, 2],
          meta: { a: 1 },
        },
      },
    ]);
    assert.deepEqual(summary, {
      total: 1,
      byField: { status: { done: 1 } },
    });
  });
});

describe("deriveAcrossDisplayValue", () => {
  const summary = summarizeWorkflowInstances([
    { workflowInstanceState: { status: "pending" } },
    { workflowInstanceState: { status: "review" } },
    { workflowInstanceState: { status: "review" } },
    { workflowInstanceState: { status: "done" } },
  ]);

  it("counts matching instances by field value", () => {
    assert.deepEqual(
      deriveAcrossDisplayValue(
        { kind: "countAcross", equals: "review" },
        "status",
        summary
      ),
      { kind: "count", value: 2 }
    );
  });

  it("counts all instances when equals is absent", () => {
    assert.deepEqual(
      deriveAcrossDisplayValue({ kind: "countAcross" }, "status", summary),
      { kind: "count", value: 4 }
    );
  });

  it("computes progress over the workflow total", () => {
    assert.deepEqual(
      deriveAcrossDisplayValue(
        { kind: "progressAcross", equals: "review" },
        "status",
        summary
      ),
      { kind: "progress", count: 2, total: 4 }
    );
  });

  it("counts zero for a missing field or value", () => {
    assert.deepEqual(
      deriveAcrossDisplayValue(
        { kind: "countAcross", equals: "nope" },
        "status",
        summary
      ),
      { kind: "count", value: 0 }
    );
    assert.deepEqual(
      deriveAcrossDisplayValue(
        { kind: "countAcross", equals: "done" },
        "missing",
        summary
      ),
      { kind: "count", value: 0 }
    );
  });
});
