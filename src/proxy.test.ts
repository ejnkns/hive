import { describe, it } from "node:test";
import assert from "node:assert";

await describe("proxy", async () => {
  await it("exports expected api", async () => {
    const mod = await import("./proxy");
    assert.ok(typeof mod.mutateRequest === "function");
    assert.ok(typeof mod.routeRequest === "function");
  });
});
