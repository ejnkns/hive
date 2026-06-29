import { HiveCore } from "../hive-core";
import { createServer, listen } from "../server";
import { printBanner } from "../shared/logger/ascii-banner";
import { getServerConfig, type ServerConfig } from "../shared/server-config";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);
  const server = await createServer();
  listen(server, config);

  const hiveCore = new HiveCore();
  hiveCore.start();

  process.on("SIGINT", () => {
    hiveCore.shutdown();
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    hiveCore.shutdown();
    server.close(() => process.exit(0));
  });

  return { server, hiveCore };
}
