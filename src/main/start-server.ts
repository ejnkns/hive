import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  shutdown,
  start,
} from "../hive-core";
import { createOrchestratorHandler } from "../orchestrator";
import { createServer, listen } from "../server";
import { printBanner } from "../shared/logger/ascii-banner";
import { getServerConfig, type ServerConfig } from "../shared/server-config";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  start();

  const workspacePath = process.env.HIVE_WORKSPACE_PATH ?? process.cwd();

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers) =>
      handleChatCompletion(body, headers),
    handleOrchestrate: createOrchestratorHandler({
      getProviders: () => getProviders(),
      workspacePath,
    }),
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
