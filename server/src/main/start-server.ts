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
  createBoardStore,
  createIntegrationManager,
  createPlanningManager,
  createProjectSpecificationStore,
  createProjectStore,
  createQueenBeeRuntimeStore,
  createRequirementsSessionManager,
  createReviewer,
  registerBoardRoutes,
  registerCoordinatorRoutes,
  registerIntegrationRoutes,
  registerProjectRoutes,
  registerRequirementsRoutes,
  registerWorkDecisionRoutes,
  registerWorkerRoutes,
} from "../server/queen-bee";
import {
  emitDraftUpdated,
  emitProjectsChanged,
} from "../server/queen-bee/worker-event-bus";

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

  const runtimeStore = createQueenBeeRuntimeStore();
  const requirementsSessionManager = createRequirementsSessionManager({
    maxToolRounds: 30,
    runtimeStore,
    onDraftUpdate: (update) => {
      const scope = update.cardId ? "card" : update.ideaId ? "idea" : "project";
      const scopeId = update.cardId ?? update.ideaId;
      emitDraftUpdated(scope, scopeId, update.content);
    },
  });
  const boardStore = createBoardStore(() => {}, runtimeStore);
  const integrationManager = createIntegrationManager(HIVE_DIR);
  const specificationStore = createProjectSpecificationStore(HIVE_DIR);
  const planningManager = createPlanningManager(
    boardStore,
    runtimeStore,
    integrationManager,
    undefined,
    specificationStore,
    30
  );
  const reviewer = createReviewer();

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
    boardStore,
    projectStore,
  });
  registerWorkDecisionRoutes(server, {
    boardStore,
    projectStore,
    integrationManager,
    runtimeStore,
    reviewer,
    workspacesBasePath: HIVE_DIR,
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
