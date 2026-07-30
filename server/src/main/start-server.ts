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
import { createFlowPersistence } from "../server/flow-persistence";
import { rehydrateFlow, setFlowPersistence } from "../server/flow-registry";
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
  registerIntegrationRoutes,
  registerProjectRoutes,
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

  // ── Flow persistence & rehydration ──

  const persistence = createFlowPersistence();
  setFlowPersistence(persistence);
  const flows = persistence.loadAllFlows();

  for (const {
    flowId,
    config: flowConfig,
    state: flowState,
    instances,
  } of flows) {
    rehydrateFlow(persistence, flowId, flowConfig, flowState, instances);
  }

  registerIntegrationRoutes(server, { integrationManager });
  registerProjectRoutes(server, projectStore, persistence);

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
