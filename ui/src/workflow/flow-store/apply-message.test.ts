import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowResponse } from "../../flow-api";
import { applyMessage } from "./apply-message";

function flow(id: string, name: string): FlowResponse {
  return {
    id,
    label: name,
    status: "idle",
    config: { definitionId: "test", name },
    workflows: [],
    instances: [],
    availableFlowActions: [],
  };
}

describe("flow-store applyMessage", () => {
  it("init replaces the whole store", () => {
    const next = applyMessage([flow("a", "A")], {
      type: "init",
      flows: [flow("b", "B")],
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["b"]
    );
  });

  it("flow_snapshot adds an unknown flow", () => {
    const next = applyMessage([flow("a", "A")], {
      type: "flow_snapshot",
      flow: flow("b", "B"),
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["a", "b"]
    );
  });

  it("flow_snapshot replaces an existing flow in place", () => {
    const updated = flow("a", "Renamed");
    const next = applyMessage([flow("a", "A"), flow("b", "B")], {
      type: "flow_snapshot",
      flow: updated,
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["a", "b"]
    );
    assert.equal(next[0].label, "Renamed");
  });

  it("flow_deleted removes the flow", () => {
    const next = applyMessage([flow("a", "A"), flow("b", "B")], {
      type: "flow_deleted",
      flowId: "a",
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["b"]
    );
  });
});
