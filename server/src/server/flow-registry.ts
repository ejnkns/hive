/** @public — generic FlowRuntime registry. No domain (queen-bee) knowledge. */

import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowRuntime,
  type FlowRuntimeAPI,
} from "workflow-engine/create-flow-runtime";
import type { OperationFn, Tool } from "workflow-engine/runners";
import type {
  ActionVariant,
  RuntimeFlowEdge,
  RuntimeGateContext,
  RuntimeWorkflowConfig,
  StateCategory,
} from "workflow-engine/workflow-types";
import { createEngineRunners } from "./engine-bridge";

const runtimes = new Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
>();
let _persistence: FlowPersistence | null = null;

// ── Flow definition registry ──

// A FlowDefinition is external config: it maps a definition id to the
// workflows + edges that build a flow, plus the domain capabilities its
// tasks call by name. Definitions are registered at the composition root
// (e.g. queen-bee registers itself); the registry itself is generic.
export type FlowDefinition = {
  id: string;
  label: string;
  buildWorkflows: (config: Record<string, unknown>) => RuntimeWorkflowConfig[];
  edges: RuntimeFlowEdge[];
  tools?: readonly Tool[];
  operations?: Record<string, OperationFn>;
};

const definitions = new Map<string, FlowDefinition>();

export function registerFlowDefinition(definition: FlowDefinition): void {
  definitions.set(definition.id, definition);
}

export function getFlowDefinition(id: string): FlowDefinition | undefined {
  return definitions.get(id);
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

// ── Project-style listing (flows with a repoPath) ──

export function getAllFlows(): Array<{
  id: string;
  repoPath: string;
  name: string;
  targetBranch: string;
  maxConcurrentWorkers: number;
}> {
  // Flow config arrives as unknown (persistence) or from the erased
  // FlowRuntimeAPI generic; the field reads below narrow known fields.
  const seen = new Set<string>();
  const result: Array<{
    id: string;
    repoPath: string;
    name: string;
    targetBranch: string;
    maxConcurrentWorkers: number;
  }> = [];

  // Flows from persistence
  if (_persistence) {
    for (const { flowId, config } of _persistence.loadAllFlows()) {
      seen.add(flowId);
      const cfg = config as Record<string, unknown>;
      result.push({
        id: flowId,
        repoPath: (cfg.repoPath as string) ?? "",
        name: (cfg.name as string) ?? flowId,
        targetBranch: (cfg.targetBranch as string) ?? "main",
        maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
      });
    }
  }

  // Flows registered directly (e.g. for tests)
  for (const [flowId, runtime] of runtimes) {
    if (seen.has(flowId)) continue;
    const cfg = runtime.getFlowConfig();
    result.push({
      id: flowId,
      repoPath: (cfg.repoPath as string) ?? "",
      name: (cfg.name as string) ?? flowId,
      targetBranch: (cfg.targetBranch as string) ?? "main",
      maxConcurrentWorkers: (cfg.maxConcurrentWorkers as number) ?? 3,
    });
  }

  return result.filter((f) => f.repoPath);
}

// ── Flow lifecycle ──

export function createFlow(
  flowId: string,
  definitionId: string,
  persistence: FlowPersistence,
  config?: Record<string, unknown>
): FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>> {
  const definition = definitions.get(definitionId);
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
  const workflows = definition.buildWorkflows(flowConfig);
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
  // single workflow). Auto tasks in the initial state run right away.
  const seedWorkflow = workflows[0];
  if (seedWorkflow) {
    const controller = runtime.addWorkflowInstance(seedWorkflow.id);
    void controller.startAutoTasks();
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
    const definition = definitions.get(definitionId);
    if (!definition) return null;
    workflows = definition.buildWorkflows(cfg);
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
  // immediately renderable; initial-state auto tasks run right away.
  const controller = runtime.addWorkflowInstance(def.id);
  void controller.startAutoTasks();

  persistence.saveFlow(flowId, flowConfig, {});
  runtimes.set(flowId, runtime);
  return runtime;
}
