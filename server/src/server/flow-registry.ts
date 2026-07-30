/** @public — manages FlowRuntime instances accessible to routes */

import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import { queenBeeFlow } from "../../../queen-bee/flow";
import { createEngineRunners } from "./engine-bridge";

const runtimes = new Map<string, FlowRuntimeAPI<any, any>>();
let _persistence: FlowPersistence | null = null;

export function setFlowPersistence(persistence: FlowPersistence): void {
  _persistence = persistence;
}

/** @private — test support */
/** @public — test support */
export function registerFlowForTest(
  flowId: string,
  runtime: FlowRuntimeAPI<any, any>
): void {
  runtimes.set(flowId, runtime);
}

export function getFlowRuntime(
  flowId: string
): FlowRuntimeAPI<any, any> | undefined {
  return runtimes.get(flowId);
}

export function getAllFlows(): Array<{
  id: string;
  repoPath: string;
  name: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
}> {
  if (!_persistence) return [];
  return _persistence
    .loadAllFlows()
    .map(({ flowId, config }) => {
      const cfg = config as Record<string, unknown>;
      return {
        id: flowId,
        repoPath: (cfg.repoPath as string) ?? "",
        name: (cfg.name as string) ?? flowId,
        targetBranch: (cfg.targetBranch as string) ?? "main",
        maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
      };
    })
    .filter((f) => f.repoPath);
}

export function unlinkFlow(flowId: string): void {
  runtimes.delete(flowId);
  // Persistence removal handled by caller — the persistence layer
  // doesn't support deletion, so we just clear the runtime.
}

export function createFlowOnLink(
  flowId: string,
  repoPath: string,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<any, any> {
  const runners = createEngineRunners();
  const flowConfig: Record<string, unknown> = {
    repoPath,
    name: config?.name ?? flowId,
    maxConcurrentWorkers: 3,
    targetBranch: "main",
    ...config,
  };
  const runtime = createFlowRuntime(
    flowId,
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    flowConfig,
    {},
    persistence
  );

  persistence.saveFlow(flowId, flowConfig, {});
  runtimes.set(flowId, runtime);
  return runtime;
}

export function rehydrateFlow(
  persistence: FlowPersistence,
  flowId: string,
  flowConfig: unknown,
  flowState: unknown,
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
    flowConfig as Record<string, unknown>,
    flowState as Record<string, unknown>,
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

  runtimes.set(flowId, runtime);
  return runtime;
}
