import type {
  GateContext,
  RunningTaskContext,
  StateDef,
  TaskOutcome,
  TaskOutputMap,
} from "./workflow-types";

// === Runtime instance state ===

export type WorkflowConfig<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  id: string;
  label: string;
  description?: string;
  taskOutputs: TTaskOutputs;
  states: readonly StateDef<TTaskOutputs, TStateId>[];
  initial: TStateId;
  terminalStates: readonly TStateId[];
};

export type WorkflowItemState<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  currentState: TStateId;
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskId: (keyof TTaskOutputs & string) | null;
  runningTaskContext: RunningTaskContext | null;
};

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

// === Reducer ===

// The pure state reducer. Takes the current state and an event, returns new
// state plus commands for the orchestrator to execute (e.g. start auto tasks).
export function reduce<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  state: WorkflowItemState<TTaskOutputs, TStateId>,
  event: WorkflowEvent<TTaskOutputs, TStateId>,
  states: readonly StateDef<TTaskOutputs, TStateId>[]
): {
  state: WorkflowItemState<TTaskOutputs, TStateId>;
  commands: WorkflowCommand[];
} {
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
          state: {
            ...newState,
            currentState: transition,
          },
          commands: [{ type: "start_auto_tasks" }],
        };
      }

      return { state: newState, commands: [] };
    }

    case "task_errored": {
      const newOutputs = {
        ...state.taskOutputs,
        [event.taskId]: { status: "error" as const, error: event.error },
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
          state: {
            ...newState,
            currentState: transition,
          },
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

// === Available actions ===

export function getAvailableActions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  states: readonly StateDef<TTaskOutputs, TStateId>[],
  currentState: TStateId,
  state: WorkflowItemState<TTaskOutputs, TStateId>
): { id: string; label: string }[] {
  const stateDef = findState(states, currentState);
  if (!stateDef?.actions) return [];

  const ctx = buildGateContext(state);

  return stateDef.actions
    .filter((action) => !action.gate || action.gate(ctx))
    .map((action) => ({ id: action.id, label: action.label }));
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

function buildGateContext<TTaskOutputs extends Record<string, unknown>>(
  state: WorkflowItemState<TTaskOutputs, string>
): GateContext<TTaskOutputs> {
  return {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    itemState: {},
  };
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

  const ctx = buildGateContext(state);

  for (const at of stateDef.autoTransitions) {
    if (at.gate(ctx)) {
      return at.to;
    }
  }

  return undefined;
}
