import { printBanner } from "shared/ascii-banner";
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
import {
  createBoardStore,
  createCoordinator,
  createIntegrationManager,
  createPlanningManager,
  createProjectSpecificationStore,
  createProjectStore,
  createQueenBeeRuntimeStore,
  createRequirementsSessionManager,
  createReviewer,
  createWorkerSupervisor,
  registerBoardRoutes,
  registerCoordinatorRoutes,
  registerIntegrationRoutes,
  registerProjectRoutes,
  registerRequirementsRoutes,
  registerWorkDecisionRoutes,
  registerWorkerRoutes,
} from "../server/queen-bee";
import {
  emitBoardEvent,
  emitDraftUpdated,
  emitProjectEvent,
  emitProjectsChanged,
  emitRequirementsDraft,
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

  const projectStore = createProjectStore(() => {
    emitProjectEvent("");
    emitProjectsChanged();
  });

  const runtimeStore = createQueenBeeRuntimeStore();
  const requirementsSessionManager = createRequirementsSessionManager(
    undefined,
    runtimeStore,
    (update) => {
      emitRequirementsDraft(update);
      const scope = update.cardId ? "card" : update.ideaId ? "idea" : "project";
      const scopeId = update.cardId ?? update.ideaId;
      emitDraftUpdated(scope, scopeId, update.content);
    }
  );
  const boardStore = createBoardStore((projectId) => {
    emitBoardEvent(projectId);
  }, runtimeStore);
  const integrationManager = createIntegrationManager();
  const specificationStore = createProjectSpecificationStore();
  const planningManager = createPlanningManager(
    boardStore,
    runtimeStore,
    integrationManager,
    undefined,
    specificationStore
  );
  const reviewer = createReviewer();
  const coordinator = createCoordinator();
  const workerSupervisor = createWorkerSupervisor(
    boardStore,
    reviewer,
    coordinator,
    runtimeStore
  );

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers, signal) =>
      handleChatCompletion(body, headers, signal),
  });

  registerProjectRoutes(server, projectStore);
  registerRequirementsRoutes(server, {
    sessionManager: requirementsSessionManager,
    projectStore,
    boardStore,
    planningManager,
  });
  registerBoardRoutes(server, {
    boardStore,
    planningManager,
    projectStore,
  });
  registerIntegrationRoutes(server, { projectStore, integrationManager });
  registerCoordinatorRoutes(server, {
    boardStore,
    projectStore,
    sessionManager: requirementsSessionManager,
    planningManager,
  });
  registerWorkerRoutes(server, {
    workerSupervisor,
    boardStore,
    projectStore,
    onWorkerEvent: (projectId, event) => {
      emitWorkerEvent(event, projectId);
    },
  });
  registerWorkDecisionRoutes(server, {
    boardStore,
    projectStore,
    integrationManager,
    runtimeStore,
    reviewer,
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
