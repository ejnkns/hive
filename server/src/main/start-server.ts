import { printBanner } from "shared/ascii-banner";
import { HIVE_DIR } from "shared/hive-dir";
import { getServerConfig, type ServerConfig } from "shared/server-config";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import { queenBeeFlow } from "../../../queen-bee/flow";
import {
  createServer,
  getOverride,
  isProviderDisabled,
  listen,
  loadProviders,
} from "../server";
import { createEngineRunners } from "../server/engine-bridge";
import { createFlowPersistence } from "../server/flow-persistence";
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
} from "../server/queen-bee";
import { emitProjectsChanged } from "../server/queen-bee/worker-event-bus";

const flowRuntimes = new Map<string, FlowRuntimeAPI<any, any>>();

export function getFlowRuntime(
  flowId: string
): FlowRuntimeAPI<any, any> | undefined {
  return flowRuntimes.get(flowId);
}

function rehydrateFlow(
  persistence: FlowPersistence,
  flowId: string,
  config: unknown,
  state: unknown,
  instances: Array<{
    workflowId: string;
    state: Record<string, unknown>;
  }>
): FlowRuntimeAPI<any, any> | null {
  if (flowId !== queenBeeFlow.id) return null;

  const runners = createEngineRunners();
  const runtime = createFlowRuntime(
    flowId,
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    config as Record<string, unknown>,
    state as Record<string, unknown>,
    persistence
  );

  for (const instance of instances) {
    const restoredState = {
      ...instance.state,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    const controller = runtime.addWorkflowInstance(
      instance.workflowId,
      restoredState
    );
    if (instance.state.hasRunningTask) {
      controller.startAutoTasks();
    }
  }

  return runtime;
}

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

  // ── Flow persistence & rehydration ──

  const persistence = createFlowPersistence();
  const flows = persistence.loadAllFlows();

  for (const {
    flowId,
    config: flowConfig,
    state: flowState,
    instances,
  } of flows) {
    const runtime = rehydrateFlow(
      persistence,
      flowId,
      flowConfig,
      flowState,
      instances
    );
    if (runtime) {
      flowRuntimes.set(flowId, runtime);
    }
  }

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
