/** @public — generic FlowRuntime registry. No domain (queen-bee) knowledge. */

import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import type { OperationFn, Tool } from "workflow-engine/runners";
import type {
  ActionVariant,
  FlowDefinition,
  RuntimeFlowEdge,
  RuntimeGateContext,
  RuntimeWorkflowConfig,
  StateCategory,
} from "workflow-engine/workflow-types";
import { createEngineRunners } from "./engine-bridge";
import { getFlowDefinition } from "./flow-definitions";

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

export function unlinkFlow(flowId: string): void {
  runtimes.delete(flowId);
  _persistence?.deleteFlow(flowId);
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

export function rehydrateFlow(
  persistence: FlowPersistence,
  flowId: string,
  flowConfig: unknown,
  flowState: unknown,
  instances: Array<{
    workflowId: string;
    state: Record<string, unknown>;
  }>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> | null {
  // flowConfig comes from persistence as unknown; its runtime shape is
  // guaranteed by the code that wrote it (createFlow / createFlowFromDefinition)
  const cfg = flowConfig as Record<string, unknown>;
  const storedDefs = cfg.workflowDefinitions as
    | RuntimeWorkflowConfig[]
    | undefined;

  let workflows: RuntimeWorkflowConfig[];
  let edges: RuntimeFlowEdge[];
  let domain: {
    tools?: readonly Tool[];
    operations?: Record<string, OperationFn>;
  } = {};

  if (storedDefs) {
    workflows = storedDefs;
    edges = [];
  } else {
    const definitionId = cfg.definitionId;
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
      restoredState
    );
    if (instance.state.hasRunningTask) {
      controller.startAutoTasks();
    }
  }

  runtimes.set(flowId, runtime);
  return runtime;
}

// ── Data-driven workflow definition types ──

export type DataDrivenStateDef = {
  id: string;
  label: string;
  description?: string;
  category?: StateCategory;
  tasks?: Array<{
    id: string;
    label: string;
    trigger: "auto" | "manual";
    role: "ai-task" | "ai-chat" | "operation";
    systemPrompt?: string;
    completionTool?: string;
  }>;
  autoTransitions?: Array<{
    to: string;
    onTaskStatus?: { taskId: string; status: "success" | "error" };
  }>;
  actions?: Array<{
    id: string;
    label: string;
    variant?: ActionVariant;
    transitionTo: string;
  }>;
};

export type DataDrivenWorkflowDef = {
  id: string;
  label: string;
  description?: string;
  states: DataDrivenStateDef[];
  initial: string;
  terminalStates: string[];
};

// ── Converter ──

function convertDataDrivenDef(
  def: DataDrivenWorkflowDef
): RuntimeWorkflowConfig {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    taskOutputs: {},
    states: def.states.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      category: s.category,
      tasks: s.tasks?.map((t) => ({
        id: t.id,
        label: t.label,
        trigger: t.trigger,
        role: t.role,
        systemPrompt: t.systemPrompt,
        completionTool: t.completionTool,
      })),
      autoTransitions: s.autoTransitions?.map((t) => {
        const statusFilter = t.onTaskStatus;
        return {
          to: t.to,
          gate:
            statusFilter !== undefined
              ? (ctx: RuntimeGateContext) => {
                  const outcome = ctx.taskOutputs[statusFilter.taskId];
                  return (
                    outcome !== undefined &&
                    "status" in outcome &&
                    outcome.status === statusFilter.status
                  );
                }
              : () => true,
        };
      }),
      actions: s.actions?.map((a) => ({
        id: a.id,
        label: a.label,
        variant: a.variant ?? "default",
        transitionTo: a.transitionTo,
      })),
    })),
    initial: def.initial,
    terminalStates: def.terminalStates,
  };
}

export function createFlowFromDefinition(
  flowId: string,
  def: DataDrivenWorkflowDef,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> {
  const runners = createEngineRunners();
  const workflowDefs = [convertDataDrivenDef(def)];
  const flowConfig: Record<string, unknown> = {
    name: def.label,
    ...config,
    workflowDefinitions: workflowDefs,
  };

  const runtime = createFlowRuntime(
    flowId,
    workflowDefs,
    [],
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    flowConfig,
    {},
    persistence
  );

  // Seed one instance in the workflow's initial state so the flow is
  // immediately renderable; fresh instances auto-run initial-state tasks.
  runtime.addWorkflowInstance(def.id);

  persistence.saveFlow(flowId, flowConfig, {});
  runtimes.set(flowId, runtime);
  return runtime;
}
