import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toWorkerSocketMessage } from "./worker-routes";

describe("worker route events", () => {
  it("preserves the unfulfillable handover event contract", () => {
    assert.deepEqual(
      toWorkerSocketMessage(
        {
          type: "unfulfillable_handover",
          cardId: "card-1",
          content: "Requirements conflict",
          suggestions: ["Revise the requirement"],
        },
        "project-1"
      ),
      {
        type: "unfulfillable_handover",
        data: {
          projectId: "project-1",
          cardId: "card-1",
          content: "Requirements conflict",
          suggestions: ["Revise the requirement"],
          error: null,
        },
      }
    );
  });
});
