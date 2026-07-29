import type { WorkflowItemState } from "./shared/workflow-item-state";
import type {
  RunningTaskContext,
  StateDef,
  TaskOutputMap,
} from "./workflow-types";

// === Events ===

export type WorkflowEvent<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> =
  | {
      type: "action_triggered";
      actionId: string;
      transitionTo: TStateId;
    }
  | {
      type: "task_started";
      taskId: keyof TTaskOutputs & string;
      context: RunningTaskContext | null;
    }
  | {
      type: "task_completed";
      taskId: keyof TTaskOutputs & string;
      output: unknown;
    }
  | {
      type: "task_errored";
      taskId: keyof TTaskOutputs & string;
      error: string;
    }
  | {
      type: "task_cancelled";
      taskId: keyof TTaskOutputs & string;
    };

// === Commands emitted to the orchestrator ===

export type WorkflowCommand = { type: "noop" } | { type: "start_auto_tasks" };

// === Reduce result ===

export type ReduceResult<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  state: WorkflowItemState<TTaskOutputs, TStateId>;
  commands: WorkflowCommand[];
};

// === Reducer ===

export function reduce<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  state: WorkflowItemState<TTaskOutputs, TStateId>,
  event: WorkflowEvent<TTaskOutputs, TStateId>,
  states: readonly StateDef<TTaskOutputs, TStateId>[]
): ReduceResult<TTaskOutputs, TStateId> {
  switch (event.type) {
    case "action_triggered": {
      const nextState: WorkflowItemState<TTaskOutputs, TStateId> = {
        ...state,
        currentState: event.transitionTo,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
      };
      return {
        state: nextState,
        commands: [{ type: "start_auto_tasks" }],
      };
    }

    case "task_started": {
      return {
        state: {
          ...state,
          hasRunningTask: true,
          runningTaskId: event.taskId,
          runningTaskContext: event.context,
        },
        commands: [],
      };
    }

    case "task_completed": {
      const newOutputs = {
        ...state.taskOutputs,
        [event.taskId]: { status: "success" as const, output: event.output },
      } as Partial<TaskOutputMap<TTaskOutputs>>;

      const newState: WorkflowItemState<TTaskOutputs, TStateId> = {
        ...state,
        taskOutputs: newOutputs,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
      };

      const transition = evaluateAutoTransitions(
        states,
        newState.currentState,
        newState
      );
      if (transition) {
        return {
          state: { ...newState, currentState: transition },
          commands: [{ type: "start_auto_tasks" }],
        };
      }

      return { state: newState, commands: [] };
    }

    case "task_errored": {
      const newOutputs = {
        ...state.taskOutputs,
        [event.taskId]: {
          status: "error" as const,
          error: event.error,
          output: undefined,
        },
      } as Partial<TaskOutputMap<TTaskOutputs>>;

      const newState: WorkflowItemState<TTaskOutputs, TStateId> = {
        ...state,
        taskOutputs: newOutputs,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
      };

      const transition = evaluateAutoTransitions(
        states,
        newState.currentState,
        newState
      );
      if (transition) {
        return {
          state: { ...newState, currentState: transition },
          commands: [{ type: "start_auto_tasks" }],
        };
      }

      return { state: newState, commands: [] };
    }

    case "task_cancelled": {
      return {
        state: {
          ...state,
          hasRunningTask: false,
          runningTaskId: null,
          runningTaskContext: null,
        },
        commands: [],
      };
    }
  }
}

// === Helpers ===

function findState<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  states: readonly StateDef<TTaskOutputs, TStateId>[],
  id: TStateId
): StateDef<TTaskOutputs, TStateId> | undefined {
  return states.find((s) => s.id === id);
}

function evaluateAutoTransitions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  states: readonly StateDef<TTaskOutputs, TStateId>[],
  currentState: TStateId,
  state: WorkflowItemState<TTaskOutputs, string>
): TStateId | undefined {
  const stateDef = findState(states, currentState);
  if (!stateDef?.autoTransitions) return undefined;

  const ctx = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    itemState: {},
  };

  for (const at of stateDef.autoTransitions) {
    if (at.gate(ctx)) {
      return at.to;
    }
  }

  return undefined;
}
