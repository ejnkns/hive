import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { RequestMetric, TelemetrySink } from "telemetry";
import { routeRequest } from "./route-request.ts";

// A mock upstream that streams SSE chunks slowly, so the test can abort
// mid-stream and exercise the destroy races in the proxy's pipe chain.
let upstream: Server;
let upstreamPort = 0;

before(async () => {
  upstream = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
    // Keep the stream open; the test aborts before this ever resolves.
    const timer = setInterval(() => {
      res.write('data: {"choices":[{"delta":{"content":"b"}}]}\n\n');
    }, 20);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", () => {
      const address = upstream.address();
      upstreamPort =
        typeof address === "object" && address !== null ? address.port : 0;
      resolve();
    });
  });
});

after(() => {
  upstream?.close();
});

describe("routeRequest mid-stream abort", () => {
  it("does not emit an unhandled error when the client disconnects mid-stream", async () => {
    const metrics: RequestMetric[] = [];
    const telemetrySink: TelemetrySink = {
      recordMetric: (metric) => metrics.push(metric),
      completeConversation: () => undefined,
    };
    const controller = new AbortController();
    const unhandled: Error[] = [];

    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(
        reason instanceof Error ? reason : new Error(String(reason))
      );
    };
    const onUncaughtException = (err: Error) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    process.on("uncaughtException", onUncaughtException);

    try {
      // Begin the request; the first upstream byte resolves it with the stream.
      const routePromise = routeRequest({
        upstreamUrl: `http://127.0.0.1:${String(upstreamPort)}`,
        mutated: { headers: {}, body: "{}" },
        timeoutMs: 10_000,
        providerName: "provider-1",
        modelName: "model-1",
        requestId: "request-1",
        telemetrySink,
        signal: controller.signal,
      });

      const { proxyResponse } = await routePromise;
      assert.ok(proxyResponse.isOk());

      // Abort mid-stream, as a client disconnect does: the abort path destroys
      // the downstream stream while the transform may still be writing.
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.deepEqual(
        unhandled.map((err) => err.message),
        [],
        "mid-stream abort must not surface an unhandled error"
      );
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
      process.removeListener("uncaughtException", onUncaughtException);
    }
  });
});
