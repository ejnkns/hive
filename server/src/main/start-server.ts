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
  initServerState,
  shutdown,
  start,
} from "../server/proxy";
import {
  createBoardStore,
  createDeviseEngine,
  createPlanner,
  createProjectStore,
  createWorkerSupervisor,
  registerBoardRoutes,
  registerDeviseRoutes,
  registerProjectRoutes,
  registerWorkerRoutes,
} from "../server/queen-bee";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  initServerState({
    getOverride,
    isProviderDisabled,
    getProviders: loadProviders,
  });

  start();

  const workspacePath = process.env.HIVE_WORKSPACE_PATH ?? process.cwd();

  const projectStore = createProjectStore(() => {
    // Phase 1: no-op on change; Phase 3+ will broadcast via WebSocket
  });

  const deviseEngine = createDeviseEngine();
  const boardStore = createBoardStore(() => {});
  const planner = createPlanner(boardStore);
  const workerSupervisor = createWorkerSupervisor(boardStore);

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

  registerProjectRoutes(server, projectStore);
  registerDeviseRoutes(server, { engine: deviseEngine, projectStore });
  registerBoardRoutes(server, { boardStore, planner, projectStore });
  registerWorkerRoutes(server, {
    workerSupervisor,
    boardStore,
    projectStore,
    onWorkerEvent: () => {},
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
