import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  shutdown,
  start,
} from "../hive-core";
import { createServer, listen } from "../server";
import { printBanner } from "../shared/logger/ascii-banner";
import { getServerConfig, type ServerConfig } from "../shared/server-config";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  start();

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers) =>
      handleChatCompletion(body, headers),
  });
  listen(server, config);

  process.on("SIGINT", () => {
    shutdown();
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    shutdown();
    server.close(() => process.exit(0));
  });

  return { server };
}
