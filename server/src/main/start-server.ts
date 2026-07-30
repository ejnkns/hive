import { printBanner } from "shared/ascii-banner";
import { HIVE_DIR } from "shared/hive-dir";
import { getServerConfig, type ServerConfig } from "shared/server-config";
import {
  createServer,
  getOverride,
  isProviderDisabled,
  listen,
  loadProviders,
} from "../server";
import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  initServerState,
  shutdown,
  start,
} from "../server/proxy";
import { loadModelPriority } from "../server/proxy/model-priority-config";
import {
  createIntegrationManager,
  createProjectStore,
  createQueenBeeRuntimeStore,
  registerIntegrationRoutes,
  registerProjectRoutes,
  registerWorkDecisionRoutes,
  registerWorkerRoutes,
} from "../server/queen-bee";
import { emitProjectsChanged } from "../server/queen-bee/worker-event-bus";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  initServerState({
    getOverride,
    isProviderDisabled,
    getProviders: loadProviders,
  });

  loadModelPriority();

  start();

  const projectStore = createProjectStore(() => {
    emitProjectsChanged();
  });

  const integrationManager = createIntegrationManager(HIVE_DIR);

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers, signal) =>
      handleChatCompletion(body, headers, signal),
  });

  registerIntegrationRoutes(server, { projectStore, integrationManager });

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
