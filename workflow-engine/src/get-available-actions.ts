import type { WorkflowItemState } from "./shared/workflow-item-state";
import type { StateDef, VisibleAction } from "./workflow-types";

export function getAvailableActions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
>(
  states: readonly StateDef<TTaskOutputs, TStateId, TItemState>[],
  currentState: TStateId,
  state: WorkflowItemState<TTaskOutputs, TStateId, TItemState>,
  countItems?: (stateId?: string) => number
): VisibleAction[] {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.actions) return [];

  const ctx = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    itemState: state.itemState,
    countItems,
  };

  return stateDef.actions
    .filter((action) => !action.gate || action.gate(ctx))
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
    }));
}
