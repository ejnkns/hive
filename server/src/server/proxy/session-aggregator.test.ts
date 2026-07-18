import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { emitFlowEvent } from "./flow-events";
import { getSessionSnapshot, onSessionPatch } from "./session-aggregator";

function ts(offset = 0) {
  return Date.now() + offset;
}

await describe("session aggregator failover chaining", async () => {
  let patches: unknown[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    patches = [];
    unsubscribe = onSessionPatch((p) => patches.push(p));
  });

  afterEach(() => {
    unsubscribe();
  });

  await it("creates separate request entries for each dispatch in a failover chain", () => {
    const requestId = "req-1";

    emitFlowEvent({
      type: "request_received",
      requestId,
      sessionId: "sess-1",
      timestamp: ts(0),
      promptPreview: "hello",
    });

    emitFlowEvent({
      type: "selection_round",
      requestId,
      strategy: "balanced",
      candidates: [],
      selected: "alpha:m1",
      poolSize: 3,
    });

    emitFlowEvent({
      type: "node_dispatched",
      requestId,
      provider: "alpha",
      model: "m1",
      attempt: 1,
    });

    emitFlowEvent({
      type: "response_complete",
      requestId,
      provider: "alpha",
      model: "m1",
      statusCode: 500,
      success: false,
      ttft: 100,
      totalLatency: 5000,
      outputTokens: null,
      finishReason: null,
      toolCallFailed: false,
      errorType: "server-error",
    });

    emitFlowEvent({
      type: "circuit_break",
      requestId,
      provider: "alpha",
      model: "m1",
      cooldownDurationSec: 30,
    });

    emitFlowEvent({
      type: "failover_attempt",
      requestId,
      failedProvider: "alpha",
      failedModel: "m1",
      errorType: "server-error",
      attempt: 1,
    });

    emitFlowEvent({
      type: "selection_round",
      requestId,
      strategy: "balanced",
      candidates: [],
      selected: "beta:m2",
      poolSize: 2,
    });

    emitFlowEvent({
      type: "node_dispatched",
      requestId,
      provider: "beta",
      model: "m2",
      attempt: 2,
    });

    emitFlowEvent({
      type: "response_complete",
      requestId,
      provider: "beta",
      model: "m2",
      statusCode: 200,
      success: true,
      ttft: 200,
      totalLatency: 3000,
      outputTokens: 50,
      finishReason: "stop",
      toolCallFailed: false,
      errorType: null,
    });

    const sessions = getSessionSnapshot();
    const session = sessions.find((s) => s.sessionId === "sess-1");
    assert.ok(session, "session should exist");

    assert.strictEqual(
      session.requests.length,
      2,
      "should have original request and one failover"
    );

    const original = session.requests.find((r) => r.requestId === requestId);
    assert.ok(original, "original request should exist");
    assert.deepStrictEqual(
      original.path,
      ["received", "selection", "dispatched", "failed"],
      "original request path should end with failed"
    );
    assert.strictEqual(original.provider, "alpha");
    assert.strictEqual(original.model, "m1");

    const failover = session.requests.find((r) => r.requestId !== requestId);
    assert.ok(failover, "failover request should exist");
    assert.ok(
      failover.requestId.includes("/F"),
      `failover requestId should contain /F, got ${failover.requestId}`
    );
    assert.deepStrictEqual(
      failover.path,
      ["selection", "dispatched", "complete"],
      "failover request path should show successful retry"
    );
    assert.strictEqual(failover.provider, "beta");
    assert.strictEqual(failover.model, "m2");
    assert.strictEqual(failover.response?.success, true);
    assert.strictEqual(failover.prompt, "hello");
  });
});
