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
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[],
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
    .filter((action) => !action.gate || action.gate(ctx))
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
    }));
}
