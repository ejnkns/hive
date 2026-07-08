import { HiveCore } from "../hive-core";
import { createServer, listen } from "../server";
import { printBanner } from "../shared/logger/ascii-banner";
import { getServerConfig, type ServerConfig } from "../shared/server-config";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  const hiveCore = new HiveCore();
  hiveCore.start();

  const server = await createServer({
    getProviders: () => hiveCore.getProviders(),
    getProviderStates: () => hiveCore.getProviderStates(),
    getLastUsed: () => hiveCore.getLastUsed(),
    handleChatCompletion: (body, headers) =>
      hiveCore.handleChatCompletion(body, headers),
  });
  listen(server, config);

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
