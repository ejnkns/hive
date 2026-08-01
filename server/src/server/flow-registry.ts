/** @public — generic FlowRuntime registry. No domain (queen-bee) knowledge. */

import { rmSync } from "node:fs";
import { join } from "node:path";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import type { OperationFn, Tool } from "workflow-engine/runners";
import type {
  ConfigField,
  FlowDefinition,
  RuntimeFlowEdge,
  RuntimeWorkflowConfig,
} from "workflow-engine/workflow-types";
import { createEngineRunners } from "./engine-bridge";
import {
  getFlowDefinition,
  getRegisteredFlowDefinition,
  loadDefinitionFromSource,
} from "./flow-definitions";

const runtimes = new Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
>();
let _persistence: FlowPersistence | null = null;

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
  _persistence?.deleteFlow(flowId);
}

// Removes operational state like unlinkFlow, and additionally deletes the
// flow's authoritative domain state under basePath/.hive. The basePath comes
// from the flow config; without one purge degrades to a plain unlink.
export function purgeFlow(flowId: string): void {
  const runtime = runtimes.get(flowId);
  const config = runtime?.getFlowConfig() as
    | Record<string, unknown>
    | undefined;
  const basePath =
    typeof config?.basePath === "string" && config.basePath !== ""
      ? config.basePath
      : undefined;

  unlinkFlow(flowId);

  if (basePath) {
    rmSync(join(basePath, ".hive"), { recursive: true, force: true });
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
    throw new Error(`Flow definition "${definitionId}" not registered`);
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

  // Seed one instance of the first workflow so the flow is immediately
  // renderable (queen-bee: the onboarding workflow; custom defs: the
  // single workflow). Fresh instances auto-run their initial-state tasks.
  const seedWorkflow = workflows[0];
  if (seedWorkflow) {
    runtime.addWorkflowInstance(seedWorkflow.id);
  }

  persistence.saveFlow(flowId, flowConfig, {});
  runtimes.set(flowId, runtime);
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
      console.warn(
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

  for (const instance of instances) {
    const restoredState = {
      ...instance.state,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
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

  runtimes.set(flowId, runtime);
  return runtime;
}
