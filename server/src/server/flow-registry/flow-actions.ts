/** @private — flow-level actions: gate evaluation, createInstance /
 * dispatchToAll execution, and form-payload collection. */

import { collectConfigFieldValues } from "workflow-engine/collect-config-field-values";
import type {
  FlowRuntimeAPI,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  ActionVariant,
  ConfigField,
  FlowLevelAction,
  RuntimeGateContext,
} from "workflow-engine/workflow-types";
import { getFlowDefinition } from "../flow-definitions.ts";
import { HttpError } from "../http-error.ts";
import { getFlowRuntime } from "./registry-state.ts";

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
  const runtime = getFlowRuntime(flowId);
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
  const runtime = getFlowRuntime(flowId);
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
    taskErrorCounts: {},
    workflowInstancesInState: (stateId) =>
      runtime.workflowInstancesInState(stateId),
  };
}

// Validates a createInstance form payload against its declared ConfigFields:
// unknown fields rejected, required fields present, values type-checked. The
// collected values become the new instance's workflowInstanceState. Delegates
// to the shared engine validator (collect-config-field-values.ts) so action
// payloads and createInstance payloads enforce identical rules.
function collectActionFields(
  fields: ConfigField[] | undefined,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const collected = collectConfigFieldValues(fields ?? [], payload);
  if (!collected.ok) {
    throw new HttpError(400, collected.error);
  }
  return collected.values;
}
