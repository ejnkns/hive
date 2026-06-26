import { describe, it } from "node:test";
import assert from "node:assert";

await describe("telemetry", async () => {
  await it("exports expected api from barrel", async () => {
    const telemetry = await import("./telemetry");
    assert.ok(typeof telemetry.calculateNodeScore === "function");
    assert.ok(typeof telemetry.loadCache === "function");
    assert.ok(typeof telemetry.saveCache === "function");
    assert.ok(typeof telemetry.telemetryRecorder === "object");
    assert.ok(typeof telemetry.startHeartbeat === "function");
    assert.ok(typeof telemetry.createStreamCounter === "function");
    assert.ok(typeof telemetry.classifyError === "function");
    assert.ok(typeof telemetry.detectRefusal === "function");
  });
});
