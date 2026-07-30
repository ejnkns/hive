import type { WorkflowInstanceState } from "./shared/workflow-instance-state";
import type { StateDef, VisibleAction } from "./workflow-types";

export function getAvailableActions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    never
  >,
>(
  states: readonly StateDef<TTaskOutputs, TStateId, TWorkflowInstanceState>[],
  currentState: TStateId,
  state: WorkflowInstanceState<TTaskOutputs, TStateId, TWorkflowInstanceState>,
  workflowInstancesInState?: (stateId?: string) => { currentState: string }[]
): VisibleAction[] {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.actions) return [];

  const ctx = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    workflowInstanceState: state.workflowInstanceState,
    workflowInstancesInState,
  } as any;

  return stateDef.actions
    .filter((action) => !action.gate || action.gate(ctx))
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
    }));
}
