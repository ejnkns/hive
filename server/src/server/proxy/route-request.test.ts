import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestMetric, TelemetrySink } from "telemetry";
import { routeRequest } from "./route-request";

describe("routeRequest cancellation", () => {
  it("rejects an aborted request without recording a provider failure", async () => {
    const metrics: RequestMetric[] = [];
    const telemetrySink: TelemetrySink = {
      recordMetric: (metric) => metrics.push(metric),
      completeConversation: () => undefined,
    };
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      routeRequest({
        upstreamUrl: "http://127.0.0.1:1",
        mutated: { headers: {}, body: "{}" },
        timeoutMs: 5_000,
        providerName: "provider-1",
        modelName: "model-1",
        requestId: "request-1",
        telemetrySink,
        signal: controller.signal,
      }),
      /aborted|cancelled/i
    );
    assert.deepEqual(metrics, []);
  });
});
