/** @public — generic FlowRuntime registry. No domain (queen-bee) knowledge. */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { logger } from "shared/logger";
import {
  createFlowRuntime,
  type FlowPersistence,
  type FlowRuntimeAPI,
  type FlowRuntimeEvent,
  type WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { OperationFn, Tool } from "workflow-engine/runners";
import { readFlowSettings } from "workflow-engine/runners";
import type {
  ActionVariant,
  ConfigField,
  FlowDefinition,
  FlowLevelAction,
  RuntimeFlowEdge,
  RuntimeGateContext,
  RuntimeWorkflowConfig,
} from "workflow-engine/workflow-types";
import { createEngineRunners } from "./engine-bridge";
import {
  getFlowDefinition,
  getRegisteredFlowDefinition,
  loadDefinitionFromSource,
} from "./flow-definitions";
import { HttpError } from "./http-error";

const runtimes = new Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
>();
let _persistence: FlowPersistence | null = null;

// ── Flow event hub ──
//
// The single authoritative stream of flow lifecycle events. Every runtime
// created or rehydrated here is wired into the hub, and unlink/purge emit a
// deletion, so a listener (e.g. the flow WebSocket endpoint) observes all flow
// state changes without subscribing to each runtime itself.

export type FlowEventBusEvent =
  | { type: "flow_deleted"; flowId: string }
  | { type: "flow_event"; flowId: string; event: FlowRuntimeEvent };

const flowEventListeners = new Set<(event: FlowEventBusEvent) => void>();

export function onFlowEvent(
  listener: (event: FlowEventBusEvent) => void
): () => void {
  flowEventListeners.add(listener);
  return () => {
    flowEventListeners.delete(listener);
  };
}

function emitFlowEvent(event: FlowEventBusEvent): void {
  for (const listener of flowEventListeners) {
    listener(event);
  }
}

// Subscribes a runtime's events into the hub. The registry owns the runtime's
// lifetime, so the subscription is never torn down explicitly — it dies with
// the runtime when unlink/purge drops the last reference.
function wireRuntimeToEventHub(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtime.on((event) => {
    emitFlowEvent({ type: "flow_event", flowId, event });
  });
}

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

// ── Instance config validation ──
//
// The definition's configSchema is the exact contract for client-supplied
// config at instantiation: required fields present with the right type, no
// unknown fields. The instance `name` is universal and validated alongside.
// Internal fields (definitionId, targetBranch, workspacesBasePath) are added
// by the server or engine and are never accepted from the client. Enforced at
// the API boundary; createFlow itself stays permissive for internal callers.
export function validateInstanceConfig(
  definitionId: string,
  config: Record<string, unknown>
): string[] {
  const definition = getFlowDefinition(definitionId);
  if (!definition) {
    return [`Flow definition "${definitionId}" not registered`];
  }

  const errors: string[] = [];
  const schema = definition.configSchema ?? [];
  const allowedKeys = new Set([...schema.map((field) => field.key), "name"]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown config field "${key}"`);
    }
  }

  for (const field of schema) {
    const value = config[field.key];
    if (value === undefined) {
      if (field.required) errors.push(`Missing required field "${field.key}"`);
      continue;
    }
    if (!configValueMatchesType(field, value)) {
      errors.push(`Config field "${field.key}" must be a ${field.type}`);
    }
  }

  if (typeof config.name !== "string" || config.name === "") {
    errors.push('Missing required field "name"');
  }

  return errors;
}

function configValueMatchesType(field: ConfigField, value: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
  }
}

// ── Flow-level actions ──
//
// Project-level actions declared on the FlowDefinition (`actions`) and rendered
// on the instance header. The server resolves them from the flow's definition,
// evaluates their gate against a flow-scoped GateContext, and executes
// createInstance or dispatchToAll through the runtime so the realtime channel
// observes the resulting events.

export type FlowLevelActionDispatchResult =
  | {
      kind: "create_instance";
      workflowId: string;
      instance: WorkflowInstanceEntry;
    }
  | { kind: "dispatch_to_all"; workflowId: string; dispatched: string[] };

// The gate-evaluated, UI-facing view of a flow-level action: enough for the
// header buttons and the createInstance form, without the gate function.
export type FlowLevelActionView = {
  id: string;
  label: string;
  variant: ActionVariant;
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

// The gate-evaluated, UI-facing list of flow-level actions for a flow.
export function getAvailableFlowActions(flowId: string): FlowLevelActionView[] {
  const runtime = runtimes.get(flowId);
  if (!runtime) return [];
  const actions = readFlowLevelActions(runtime);
  if (actions.length === 0) return [];
  const ctx = buildFlowGateContext(runtime);
  return actions
    .filter((action) => action.gate === undefined || action.gate(ctx))
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
      ...(action.createInstance
        ? {
            createInstance: {
              workflowId: action.createInstance.workflowId,
              fields: action.createInstance.fields ?? [],
            },
          }
        : {}),
      ...(action.dispatchToAll ? { dispatchToAll: action.dispatchToAll } : {}),
    }));
}

// Executes a flow-level action. Throws HttpError for a missing flow/action
// (404), a failing gate (409), or an invalid form payload (400).
export function dispatchFlowLevelAction(
  flowId: string,
  actionId: string,
  payload: Record<string, unknown>
): FlowLevelActionDispatchResult {
  const runtime = runtimes.get(flowId);
  if (!runtime) throw new HttpError(404, "Flow not found");

  const action = readFlowLevelActions(runtime).find((a) => a.id === actionId);
  if (!action)
    throw new HttpError(404, `Flow-level action "${actionId}" not found`);

  const ctx = buildFlowGateContext(runtime);
  if (action.gate !== undefined && !action.gate(ctx)) {
    throw new HttpError(
      409,
      `Flow-level action "${actionId}" is not available`
    );
  }

  if (action.createInstance) {
    const { workflowId, fields } = action.createInstance;
    const instanceState = collectActionFields(fields, payload);
    const before = new Set(
      runtime.getWorkflowInstanceEntries().map((entry) => entry.id)
    );
    runtime.addWorkflowInstance(workflowId, {
      workflowInstanceState: instanceState,
    });
    const instance = runtime
      .getWorkflowInstanceEntries()
      .find(
        (entry) => entry.workflowId === workflowId && !before.has(entry.id)
      );
    if (!instance)
      throw new HttpError(400, "Flow-level action did not create an instance");
    return { kind: "create_instance", workflowId, instance };
  }

  if (action.dispatchToAll) {
    const { workflowId, actionId: targetActionId } = action.dispatchToAll;
    const dispatched: string[] = [];
    for (const entry of runtime.getWorkflowInstanceEntries()) {
      if (entry.workflowId !== workflowId) continue;
      if (!entry.availableActions.some((a) => a.id === targetActionId))
        continue;
      runtime.getWorkflowInstance(entry.id)?.dispatchAction(targetActionId);
      dispatched.push(entry.id);
    }
    return { kind: "dispatch_to_all", workflowId, dispatched };
  }

  throw new HttpError(
    400,
    `Flow-level action "${actionId}" declares no behavior`
  );
}

function readFlowLevelActions(
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): FlowLevelAction[] {
  const config = runtime.getFlowConfig();
  const definitionId = config.definitionId;
  const definition =
    typeof definitionId === "string"
      ? getFlowDefinition(definitionId)
      : undefined;
  return definition?.actions ?? [];
}

function buildFlowGateContext(
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): RuntimeGateContext {
  return {
    taskOutputs: {},
    hasRunningTask: runtime.workflowInstances.some((s) => s.hasRunningTask),
    runningTaskContext: null,
    workflowInstanceState: {},
    flowState: runtime.getFlowState(),
    workflowInstancesInState: (stateId) =>
      runtime.workflowInstancesInState(stateId),
  };
}

// Validates a createInstance form payload against its declared ConfigFields:
// unknown fields rejected, required fields present, values type-checked. The
// collected values become the new instance's workflowInstanceState.
function collectActionFields(
  fields: ConfigField[] | undefined,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const declared = new Set((fields ?? []).map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!declared.has(key)) {
      throw new HttpError(400, `Unknown field "${key}"`);
    }
  }

  const collected: Record<string, unknown> = {};
  for (const field of fields ?? []) {
    const value = payload[field.key];
    if (value === undefined) {
      if (field.required) {
        throw new HttpError(400, `Missing required field "${field.key}"`);
      }
      continue;
    }
    if (!configValueMatchesType(field, value)) {
      throw new HttpError(400, `Field "${field.key}" must be a ${field.type}`);
    }
    collected[field.key] = value;
  }
  return collected;
}

// ── Persistence accessors ──

export function setFlowPersistence(persistence: FlowPersistence): void {
  _persistence = persistence;
}

export function getFlowPersistence(): FlowPersistence | null {
  return _persistence;
}

// ── Runtime accessors ──

export function registerFlowForTest(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtimes.set(flowId, runtime);
  wireRuntimeToEventHub(flowId, runtime);
}

export function getFlowRuntime(
  flowId: string
):
  | FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
  | undefined {
  return runtimes.get(flowId);
}

export function getFlowRuntimes(): Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
> {
  return runtimes;
}

// Test seam: clears the live runtime map so tests start fresh. Production
// callers never invoke this.
export function resetFlowRuntimesForTest(): void {
  runtimes.clear();
}

export function unlinkFlow(flowId: string): void {
  runtimes.delete(flowId);
  emitFlowEvent({ type: "flow_deleted", flowId });
  _persistence?.deleteFlow(flowId);
}

// Removes operational state like unlinkFlow, and additionally deletes the
// flow's authoritative domain state under basePath/<domainDir>. The domain
// root comes from the flow config (default .<definition-id>); without a base
// path purge degrades to a plain unlink.
export function purgeFlow(flowId: string): void {
  const runtime = runtimes.get(flowId);
  const config = runtime?.getFlowConfig() as
    | Record<string, unknown>
    | undefined;
  const { basePath, domainDir } = readFlowSettings(config ?? {});

  unlinkFlow(flowId);

  if (basePath && domainDir) {
    rmSync(join(basePath, domainDir), { recursive: true, force: true });
  }
}

// ── Flow lifecycle ──

export function createFlow(
  flowId: string,
  definitionId: string,
  persistence: FlowPersistence,
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
  runtimes.set(flowId, runtime);
  wireRuntimeToEventHub(flowId, runtime);

  // Seed one instance of the first workflow so the flow is immediately
  // renderable (queen-bee: the onboarding workflow; custom defs: the
  // single workflow). Fresh instances auto-run their initial-state tasks.
  const seedWorkflow = workflows[0];
  if (seedWorkflow) {
    runtime.addWorkflowInstance(seedWorkflow.id);
  }

  persistence.saveFlow(flowId, flowConfig, {});
  return runtime;
}

export async function rehydrateFlow(
  persistence: FlowPersistence,
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

  runtimes.set(flowId, runtime);
  wireRuntimeToEventHub(flowId, runtime);

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
