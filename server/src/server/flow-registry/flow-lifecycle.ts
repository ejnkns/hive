/** @private — flow lifecycle: definition resolution, createFlow (seed the
 * first instance), and rehydrateFlow (rebuild a runtime from persistence). */

import { logger } from "shared/logger";
import type { FlowRuntimeAPI } from "workflow-engine/create-flow-runtime";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import type { OperationFn, Tool } from "workflow-engine/runners";
import type {
  FlowDefinition,
  RuntimeFlowEdge,
  RuntimeWorkflowConfig,
} from "workflow-engine/workflow-types";
import { createEngineRunners } from "../engine-bridge.ts";
import {
  getFlowDefinition,
  getRegisteredFlowDefinition,
  loadDefinitionFromSource,
} from "../flow-definitions.ts";
import type { FlowStore } from "../flow-persistence.ts";
import { HttpError } from "../http-error.ts";
import { registerRuntime } from "./registry-state.ts";

// ── Flow definition registry ──
//
// The definition library (register/list/get/delete, TS loading, persistence)
// lives in flow-definitions.ts. The registry here is generic: it owns only the
// FlowRuntime instances, resolving definitions by id on demand.

function resolveWorkflows(
  definition: FlowDefinition,
  config: Record<string, unknown>
): RuntimeWorkflowConfig[] {
  if ("buildWorkflows" in definition) {
    return definition.buildWorkflows(config);
  }
  return definition.workflows;
}

// ── Flow lifecycle ──

export function createFlow(
  flowId: string,
  definitionId: string,
  persistence: FlowStore,
  config?: Record<string, unknown>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> {
  const definition = getFlowDefinition(definitionId);
  if (!definition) {
    throw new HttpError(
      404,
      `Flow definition "${definitionId}" not registered`
    );
  }

  const flowConfig: Record<string, unknown> = {
    definitionId,
    ...config,
  };

  // Snapshot the definition source for user definitions so the instance keeps
  // its creation-time behavior even if the definition is later edited or
  // deleted. Built-ins ship with the server and are never editable, so their
  // live definition is authoritative.
  const registered = getRegisteredFlowDefinition(definitionId);
  if (registered && !registered.builtIn && registered.source) {
    flowConfig.definitionSource = registered.source;
  }

  const runners = createEngineRunners({
    tools: definition.tools,
    operations: definition.operations,
  });
  const workflows = resolveWorkflows(definition, flowConfig);
  const runtime = createFlowRuntime(
    flowId,
    workflows,
    definition.edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    flowConfig,
    {},
    persistence
  );

  // Register the runtime and wire it into the event hub BEFORE seeding the
  // first instance, so the seed's events (instance_created, auto task starts)
  // reach connected clients and the runtime is already findable by flowId
  // while the hub transforms them into snapshots.
  registerRuntime(flowId, runtime);

  // Seed one instance of the first workflow so the flow is immediately
  // renderable (queen-bee: the onboarding workflow; custom defs: the
  // single workflow). Fresh instances auto-run their initial-state tasks —
  // but only seed when doing so cannot start a pointless AI run: an empty
  // seed in a workflow whose initial state auto-runs an AI task that declares
  // instance input would run the agent with nothing to work on (a phantom
  // instance that burns a model call). Auto operation tasks are fine —
  // queen-bee's onboarding configures the flow from nothing.
  const seedWorkflow = workflows[0];
  const seedInitial = seedWorkflow?.states.find(
    (state) => state.id === seedWorkflow.initial
  );
  const seedStartsInputlessAi = (seedInitial?.tasks ?? []).some(
    (task) =>
      task.trigger === "auto" &&
      (task.role === "ai-task" || task.role === "ai-chat") &&
      task.inputFromInstanceState !== undefined
  );
  if (seedWorkflow && !seedStartsInputlessAi) {
    runtime.addWorkflowInstance(seedWorkflow.id);
  }

  persistence.saveFlow(flowId, flowConfig, {});
  return runtime;
}

export async function rehydrateFlow(
  persistence: FlowStore,
  flowId: string,
  flowConfig: unknown,
  flowState: unknown,
  instances: Array<{
    instanceId: string;
    workflowId: string;
    state: Record<string, unknown>;
  }>
): Promise<FlowRuntimeAPI<
  Record<string, unknown>,
  Record<string, unknown>
> | null> {
  // flowConfig comes from persistence as unknown; its runtime shape is
  // guaranteed by the code that wrote it (createFlow).
  const cfg = flowConfig as Record<string, unknown>;

  let workflows: RuntimeWorkflowConfig[];
  let edges: RuntimeFlowEdge[];
  let domain: {
    tools?: readonly Tool[];
    operations?: Record<string, OperationFn>;
  } = {};

  // A user-definition snapshot re-transpiles the creation-time source so a
  // later definition edit/delete cannot change the instance's behavior. Reuse
  // the live definition for built-ins (never editable) and legacy flows.
  const snapshotSource =
    typeof cfg.definitionSource === "string" ? cfg.definitionSource : undefined;
  const definitionId = cfg.definitionId;

  if (snapshotSource && typeof definitionId === "string") {
    try {
      const snapshotFlow = await loadDefinitionFromSource(
        `snapshot-${flowId}`,
        snapshotSource,
        definitionId
      );
      workflows = resolveWorkflows(snapshotFlow, cfg);
      edges = snapshotFlow.edges;
      domain = {
        tools: snapshotFlow.tools,
        operations: snapshotFlow.operations,
      };
    } catch (err) {
      logger.warn(
        `Flow "${flowId}" snapshot failed to load, falling back to live definition: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      if (typeof definitionId !== "string") return null;
      const definition = getFlowDefinition(definitionId);
      if (!definition) return null;
      workflows = resolveWorkflows(definition, cfg);
      edges = definition.edges;
      domain = { tools: definition.tools, operations: definition.operations };
    }
  } else {
    if (typeof definitionId !== "string") return null;
    const definition = getFlowDefinition(definitionId);
    if (!definition) return null;
    workflows = resolveWorkflows(definition, cfg);
    edges = definition.edges;
    domain = { tools: definition.tools, operations: definition.operations };
  }

  const runners = createEngineRunners(domain);
  const runtime = createFlowRuntime(
    flowId,
    workflows,
    edges,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    cfg,
    flowState as Record<string, unknown>,
    persistence
  );

  registerRuntime(flowId, runtime);

  for (const instance of instances) {
    const restoredState = {
      ...instance.state,
      // Running tasks cannot survive a server restart — the in-memory
      // runner is gone. Clear the running flag but preserve the
      // runningTaskContext (chat messages, session transcript) so the
      // session history is not lost.
      hasRunningTask: false,
      runningTaskId: null,
    };
    const controller = runtime.addWorkflowInstance(
      instance.workflowId,
      restoredState,
      instance.instanceId
    );
    if (instance.state.hasRunningTask) {
      controller.startAutoTasks();
    }
  }

  return runtime;
}
