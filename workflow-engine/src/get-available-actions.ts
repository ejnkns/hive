import { dependsOnMet, readDependsOn } from "./dependency-satisfaction.ts";
import { evaluateGate } from "./evaluate-gate.ts";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state.ts";
import type { WorkflowInstancesInState } from "./task-runner.ts";
import type {
  RuntimeGateContext,
  RuntimeStateDef,
  VisibleAction,
} from "./workflow-types.ts";

export function getAvailableActions(
  states: readonly RuntimeStateDef[],
  currentState: string,
  state: RuntimeWorkflowInstanceState,
  workflowInstancesInState?: WorkflowInstancesInState,
  flowState?: Record<string, unknown>,
  instanceTitlePath?: string
): VisibleAction[] {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.actions) return [];

  const ctx: RuntimeGateContext = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    workflowInstanceState: state.workflowInstanceState,
    flowState: flowState ?? {},
    taskErrorCounts: state.taskErrorCounts ?? {},
    workflowInstancesInState,
  };

  return stateDef.actions
    .filter((action) => {
      // Fail-safe: a throwing visibility gate hides the action (the action
      // cannot be evaluated, so it is not offered) instead of breaking the
      // snapshot.
      if (action.gate && !evaluateGate(action.gate, ctx)) return false;
      if (action.dependsOnState !== undefined && workflowInstancesInState) {
        const dependees = readDependsOn(state.workflowInstanceState);
        if (
          !dependsOnMet(
            dependees,
            workflowInstancesInState(undefined, action.dependsOnState),
            instanceTitlePath
          )
        ) {
          return false;
        }
      }
      return true;
    })
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? "default",
      fields: action.fields,
      ...(action.confirmText !== undefined
        ? { confirmText: action.confirmText }
        : {}),
    }));
}
