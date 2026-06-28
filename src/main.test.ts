import { describe, it, after } from "node:test";
import assert from "node:assert";

type HiveModule = {
  _server: { close(): void };
  _hiveCore: { shutdown(): void };
};

await describe("hive", async () => {
  let mod: HiveModule | undefined;

  await it("loads without error", async () => {
    mod = await import("./main.js");
    assert.ok(mod._server);
  });

  after(() => {
    if (mod) {
      mod._server.close();
      mod._hiveCore.shutdown();
    }
  });
});
