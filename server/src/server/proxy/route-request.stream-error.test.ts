import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { RequestMetric, TelemetrySink } from "telemetry";
import { routeRequest } from "./route-request.ts";

// A mock upstream that begins an SSE stream and then fails mid-stream: either
// a connection reset (ECONNRESET — the error event path) or a clean close
// without the [DONE] terminator (the abrupt-end path). Both leave the
// downstream consumer with an incomplete response; it must settle with an
// error instead of hanging open forever.
let upstream: Server;
let upstreamPort = 0;

before(async () => {
  upstream = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n'
    );
    if (req.url === "/reset") {
      // The provider's connection is reset after the stream has started.
      setTimeout(() => res.destroy(new Error("read ECONNRESET")), 30);
    } else {
      // The provider closes the stream without sending [DONE].
      res.end();
    }
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

function route(upstreamPath: string) {
  const metrics: RequestMetric[] = [];
  const telemetrySink: TelemetrySink = {
    recordMetric: (metric) => metrics.push(metric),
    completeConversation: () => undefined,
  };
  return routeRequest({
    upstreamUrl: `http://127.0.0.1:${String(upstreamPort)}${upstreamPath}`,
    mutated: { headers: {}, body: "{}" },
    timeoutMs: 10_000,
    providerName: "provider-1",
    modelName: "model-1",
    requestId: "request-1",
    telemetrySink,
  }).then(({ proxyResponse }) => ({ proxyResponse, metrics }));
}

// Waits for the downstream stream to settle (error or end) with a timeout, so
// a hang fails the test instead of blocking it forever.
function streamOutcome(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    stream.on("error", () => resolve("error"));
    stream.on("end", () => resolve("end"));
    const timer = setTimeout(
      () => reject(new Error("stream hung — never settled")),
      3_000
    );
    timer.unref();
  });
}

describe("routeRequest mid-stream upstream failure", () => {
  it("settles the downstream stream with an error when the connection resets mid-stream", async () => {
    const { proxyResponse } = await route("/reset");
    assert.ok(
      proxyResponse.isOk(),
      "the first byte resolves the request with the stream before the reset lands"
    );
    const outcome = await streamOutcome(proxyResponse.getStream());
    assert.equal(
      outcome,
      "error",
      "a mid-stream reset must surface as a stream error, not hang"
    );
  });

  it("settles the downstream stream with an error when the upstream ends without [DONE]", async () => {
    const { proxyResponse } = await route("/abrupt");
    assert.ok(proxyResponse.isOk());
    const outcome = await streamOutcome(proxyResponse.getStream());
    assert.equal(
      outcome,
      "error",
      "an incomplete stream must surface as an error, not commit a truncated reply"
    );
  });
});
