import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entry } from "./test-fixtures.ts";

describe("entry", () => {
  it("tracks a reassignment of the instance state on `values`", () => {
    const fixture = entry("card-1", "ready");
    fixture.state.workflowInstanceState = { title: "Reassigned" };
    assert.deepEqual(fixture.values, { title: "Reassigned" });
  });

  it("reads the same bag as the runtime wrapper", () => {
    const fixture = entry("card-1", "ready");
    assert.equal(fixture.values, fixture.state.workflowInstanceState);
  });
});
