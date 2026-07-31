/** @private — queen-bee flow definition factory. */

import type { RuntimeWorkflowConfig } from "workflow-engine/workflow-types";
import { queenBeeFlow } from "../../../../presets/queen-bee/flow";
import type { FlowDefinition } from "../flow-registry";

// ── Queen-bee flow definition (external config, registered at boot) ──

function resolveWorkflowConfigs(
  config: Record<string, unknown>
): RuntimeWorkflowConfig[] {
  const maxWorkers = readMaxWorkers(config);
  const systemPrompts = readSystemPrompts(config);

  return queenBeeFlow.workflows.map((wf) => ({
    ...wf,
    states: wf.states.map((state) => ({
      ...state,
      actions: state.actions?.map((action) => {
        if (
          action.id === "run" &&
          wf.id === "cards" &&
          action.maxWorkflowInstancesInTarget !== undefined
        ) {
          return { ...action, maxWorkflowInstancesInTarget: maxWorkers };
        }
        return action;
      }),
      tasks: state.tasks?.map((task) => {
        if (task.systemPrompt && systemPrompts?.[task.id]) {
          return { ...task, systemPrompt: systemPrompts[task.id] };
        }
        return task;
      }),
    })),
  }));
}

function readMaxWorkers(config: Record<string, unknown>): number {
  const raw = config.maxConcurrentWorkers;
  return typeof raw === "number" ? raw : 3;
}

function readSystemPrompts(
  config: Record<string, unknown>
): Record<string, string> | undefined {
  const raw = config.systemPrompts;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export const queenBeeFlowDefinition: FlowDefinition = {
  id: queenBeeFlow.id,
  label: queenBeeFlow.label,
  buildWorkflows: resolveWorkflowConfigs,
  edges: queenBeeFlow.edges,
  tools: queenBeeFlow.tools,
  operations: queenBeeFlow.operations,
};
