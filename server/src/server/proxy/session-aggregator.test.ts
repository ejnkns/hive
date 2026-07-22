import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SessionSnapshot } from "shared/dashboard-types";
import {
  getSessionSnapshot,
  recordCircuitBreak,
  recordFailoverAttempt,
  recordNodeDispatched,
  recordRequestReceived,
  recordResponseComplete,
  recordSelectionRound,
  setAggregatorCallbacks,
} from "./session-aggregator";

function ts(offset = 0) {
  return Date.now() + offset;
}

await describe("session aggregator failover chaining", async () => {
  let snapshots: SessionSnapshot[] = [];
  let pipelineEvents: unknown[] = [];

  beforeEach(() => {
    snapshots = [];
    pipelineEvents = [];
    setAggregatorCallbacks({
      onSnapshot: (s) => snapshots.push(s),
      onPipelineState: (e) => pipelineEvents.push(e),
    });
  });

  afterEach(() => {
    setAggregatorCallbacks({ onSnapshot() {}, onPipelineState() {} });
  });

  await it("creates separate request entries for each dispatch in a failover chain", () => {
    const requestId = "req-1";

    recordRequestReceived({
      requestId,
      sessionId: "sess-1",
      timestamp: ts(0),
      promptPreview: "hello",
    });

    recordSelectionRound({
      requestId,
      strategy: "balanced",
      candidates: [],
      selected: "alpha:m1",
      poolSize: 3,
    });

    recordNodeDispatched({
      requestId,
      provider: "alpha",
      model: "m1",
      attempt: 1,
    });

    recordResponseComplete({
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

    recordCircuitBreak({
      requestId,
      provider: "alpha",
      model: "m1",
      cooldownDurationSec: 30,
    });

    recordFailoverAttempt({
      requestId,
      failedProvider: "alpha",
      failedModel: "m1",
      errorType: "server-error",
      attempt: 1,
    });

    recordSelectionRound({
      requestId,
      strategy: "balanced",
      candidates: [],
      selected: "beta:m2",
      poolSize: 2,
    });

    recordNodeDispatched({
      requestId,
      provider: "beta",
      model: "m2",
      attempt: 2,
    });

    recordResponseComplete({
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
    const allSessions = [...sessions.active, ...sessions.completed];
    const session = allSessions.find((s) => s.sessionId === "sess-1");
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
