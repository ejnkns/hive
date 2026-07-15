import { printBanner } from "shared/ascii-banner";
import { getServerConfig, type ServerConfig } from "shared/server-config";
import {
  createServer,
  getOverride,
  isProviderDisabled,
  listen,
  loadProviders,
} from "../server";
import { createOrchestratorHandler } from "../server/orchestrator";
import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  initCore,
  shutdown,
  start,
} from "../server/proxy";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  initCore({
    getOverride,
    isProviderDisabled,
    getProviders: loadProviders,
  });

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
