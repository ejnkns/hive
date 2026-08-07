import { resolveDottedPath } from "./runners/resolve-dotted-path";
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
    workflowInstancesInState,
  };

  return stateDef.actions
    .filter((action) => {
      if (action.gate && !action.gate(ctx)) return false;
      if (action.dependsOnState !== undefined && workflowInstancesInState) {
        const dependees = readDependsOn(state.workflowInstanceState);
        if (
          !dependsOnMet(
            dependees,
            workflowInstancesInState(action.dependsOnState),
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
    }));
}

// The dependsOnState gate: every dependee must already be in the target state.
// Entries are instance IDs after name-resolution — but resolution runs only on
// edge fan-out, so rehydrated or directly-created instances may carry the
// dependency's name instead. A name entry matches the title (the workflow's
// instance.title hint) of any instance already in the target state, so a card
// becomes runnable as soon as its named dependency lands, regardless of how
// the dependency was recorded.
export function dependsOnMet(
  dependees: string[],
  inState: Array<{
    id: string;
    workflowInstanceState: Record<string, unknown>;
  }>,
  titlePath: string | undefined
): boolean {
  if (dependees.length === 0) return true;
  const idSet = new Set(inState.map((instance) => instance.id));
  return dependees.every((dependee) => {
    if (idSet.has(dependee)) return true;
    if (titlePath === undefined) return false;
    return inState.some((instance) => {
      const title = resolveDottedPath(
        instance.workflowInstanceState,
        titlePath
      );
      return typeof title === "string" && title === dependee;
    });
  });
}

// dependsOn is written into workflowInstanceState by the flow edges /
// callers as a string[]; it is not part of the domain type contract.
function readDependsOn(itemState: Record<string, unknown>): string[] {
  const raw = itemState.dependsOn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
