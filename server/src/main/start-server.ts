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
  createCoordinator,
  createDeviseEngine,
  createPlanner,
  createProjectStore,
  createReviewer,
  createWorkerSupervisor,
  registerBoardRoutes,
  registerCoordinatorRoutes,
  registerDeviseRoutes,
  registerProjectRoutes,
  registerWorkerRoutes,
} from "../server/queen-bee";
import {
  emitBoardEvent,
  emitProjectEvent,
  emitWorkerEvent,
} from "../server/queen-bee/worker-event-bus";

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
    emitProjectEvent("");
  });

  const deviseEngine = createDeviseEngine();
  const boardStore = createBoardStore((projectId) => {
    emitBoardEvent(projectId);
  });
  const planner = createPlanner(boardStore);
  const reviewer = createReviewer();
  const coordinator = createCoordinator();
  const workerSupervisor = createWorkerSupervisor(
    boardStore,
    reviewer,
    coordinator
  );

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
  registerDeviseRoutes(server, {
    engine: deviseEngine,
    projectStore,
    boardStore,
  });
  registerBoardRoutes(server, { boardStore, planner, projectStore });
  registerCoordinatorRoutes(server, {
    boardStore,
    projectStore,
    engine: deviseEngine,
  });
  registerWorkerRoutes(server, {
    workerSupervisor,
    boardStore,
    projectStore,
    onWorkerEvent: (projectId, event) => {
      emitWorkerEvent(event, projectId);
    },
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
