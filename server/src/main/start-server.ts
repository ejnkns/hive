import { printBanner } from "shared/ascii-banner";
import { getServerConfig, type ServerConfig } from "shared/server-config";
import {
  createServer,
  getOverride,
  isProviderDisabled,
  listen,
  loadProviders,
} from "../server";
import { registerFlowApiRoutes } from "../server/flow-api-routes";
import { createFlowPersistence } from "../server/flow-persistence";
import {
  registerFlowDefinition,
  rehydrateFlow,
  setFlowPersistence,
} from "../server/flow-registry";
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
  queenBeeFlowDefinition,
  registerIntegrationRoutes,
  registerProjectRoutes,
} from "../server/queen-bee";

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

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers, signal) =>
      handleChatCompletion(body, headers, signal),
  });

  // ── Flow persistence & rehydration ──

  // Register external flow definitions before rehydration so persisted
  // flows can rebuild their runtimes from the definition registry.
  registerFlowDefinition(queenBeeFlowDefinition);

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

  registerFlowApiRoutes(server);
  registerIntegrationRoutes(server);
  registerProjectRoutes(server, persistence);

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
