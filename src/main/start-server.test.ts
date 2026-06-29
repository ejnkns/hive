import assert from "node:assert";
import { after, describe, it } from "node:test";

import { startServer } from "./start-server";

type HiveModule = {
  server: { close(): void };
  hiveCore: { shutdown(): void };
};

await describe("hive", async () => {
  let mod: HiveModule | undefined;

  await it("loads and starts without error", async () => {
    mod = await startServer();
    assert.ok(mod.server);
  });

  after(() => {
    if (mod) {
      mod.server.close();
      mod.hiveCore.shutdown();
    }
  });
});
