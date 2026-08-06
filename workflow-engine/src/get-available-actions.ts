import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state";
import type {
  RuntimeGateContext,
  RuntimeStateDef,
  VisibleAction,
} from "./workflow-types";

export function getAvailableActions(
  states: readonly RuntimeStateDef[],
  currentState: string,
  state: RuntimeWorkflowInstanceState,
  workflowInstancesInState?: (stateId?: string) => {
    currentState: string;
    id: string;
    workflowInstanceState: Record<string, unknown>;
  }[],
  flowState?: Record<string, unknown>
): VisibleAction[] {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.actions) return [];

  const ctx: RuntimeGateContext = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    workflowInstanceState: state.workflowInstanceState,
    flowState: flowState ?? {},
    workflowInstancesInState,
  };

  return stateDef.actions
    .filter((action) => {
      if (action.gate && !action.gate(ctx)) return false;
      if (action.dependsOnState !== undefined && workflowInstancesInState) {
        const dependees = readDependsOn(state.workflowInstanceState);
        if (dependees.length > 0) {
          const inStateIds = new Set(
            workflowInstancesInState(action.dependsOnState).map(
              (instance) => instance.id
            )
          );
          if (!dependees.every((d) => inStateIds.has(d))) return false;
        }
      }
      return true;
    })
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
    }));
}

// dependsOn is written into workflowInstanceState by the flow edges /
// callers as a string[]; it is not part of the domain type contract.
function readDependsOn(itemState: Record<string, unknown>): string[] {
  const raw = itemState.dependsOn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
