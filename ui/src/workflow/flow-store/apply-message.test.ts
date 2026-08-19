import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowResponse } from "../../flow-api.ts";
import { applyMessage } from "./apply-message.ts";

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
  it("init upserts a flow present in both the store and the frame", () => {
    const next = applyMessage([flow("a", "A"), flow("b", "B")], {
      type: "init",
      flows: [flow("a", "Renamed")],
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["a", "b"]
    );
    assert.equal(next[0].label, "Renamed");
  });

  it("init keeps a flow in the store but absent from the frame", () => {
    const next = applyMessage([flow("a", "A"), flow("b", "B")], {
      type: "init",
      flows: [flow("b", "B")],
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["a", "b"]
    );
  });

  it("init adds a flow present in the frame but not yet in the store", () => {
    const next = applyMessage([flow("a", "A")], {
      type: "init",
      flows: [flow("b", "B")],
    });
    assert.deepEqual(
      next.map((f) => f.id),
      ["a", "b"]
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
