import type { WorkflowItemState } from "./workflow-state";
import type { GateContext, StateDef } from "./workflow-types";

export function getAvailableActions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  states: readonly StateDef<TTaskOutputs, TStateId>[],
  currentState: TStateId,
  state: WorkflowItemState<TTaskOutputs, TStateId>
): { id: string; label: string }[] {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.actions) return [];

  const ctx = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    itemState: {},
  };

  return stateDef.actions
    .filter((action) => !action.gate || action.gate(ctx))
    .map((action) => ({ id: action.id, label: action.label }));
}
