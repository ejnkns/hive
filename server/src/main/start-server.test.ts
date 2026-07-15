import assert from "node:assert";
import { after, describe, it } from "node:test";

import { shutdown } from "../server/proxy";
import { startServer } from "./start-server";

await describe("hive", async () => {
  let server: { close(): void } | undefined;

  await it("loads and starts without error", async () => {
    const result = await startServer();
    server = result.server;
    assert.ok(server);
  });

  after(() => {
    if (server) {
      server.close();
      shutdown();
    }
  });
});
