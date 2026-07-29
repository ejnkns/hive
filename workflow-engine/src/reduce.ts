import type { WorkflowItemState } from "./shared/workflow-item-state";
import type {
  RunningTaskContext,
  StateDef,
  TaskOutputMap,
  WorkflowHistoryEntry,
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
      metadata?: Record<string, unknown>;
    }
  | {
      type: "task_metadata_patched";
      taskId: keyof TTaskOutputs & string;
      metadata: Record<string, unknown>;
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
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  state: WorkflowItemState<TTaskOutputs, TStateId, TItemState>;
  commands: WorkflowCommand[];
};

// === Reducer ===

export function reduce<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
>(
  state: WorkflowItemState<TTaskOutputs, TStateId, TItemState>,
  event: WorkflowEvent<TTaskOutputs, TStateId>,
  states: readonly StateDef<TTaskOutputs, TStateId, TItemState>[]
): ReduceResult<TTaskOutputs, TStateId, TItemState> {
  switch (event.type) {
    case "action_triggered": {
      const transitionEntry: WorkflowHistoryEntry<TTaskOutputs, TStateId> = {
        type: "state_transition",
        fromState: state.currentState,
        toState: event.transitionTo,
        timestamp: new Date().toISOString(),
        actionId: event.actionId,
      };
      const nextState: WorkflowItemState<TTaskOutputs, TStateId, TItemState> = {
        ...state,
        currentState: event.transitionTo,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        history: [...state.history, transitionEntry],
      };
      return {
        state: nextState,
        commands: [{ type: "start_auto_tasks" }],
      };
    }

    case "task_started": {
      const previousAttempts = state.history.filter(
        (h) => h.type === "task_execution" && h.taskId === event.taskId
      ).length;
      const taskEntry: WorkflowHistoryEntry<TTaskOutputs, TStateId> = {
        type: "task_execution",
        taskId: event.taskId,
        attempt: previousAttempts + 1,
        status: "running",
        startedAt: new Date().toISOString(),
        context: event.context,
        metadata: event.metadata,
      };
      return {
        state: {
          ...state,
          hasRunningTask: true,
          runningTaskId: event.taskId,
          runningTaskContext: event.context,
          history: [...state.history, taskEntry],
        },
        commands: [],
      };
    }

    case "task_metadata_patched": {
      const history = state.history.map((h) => {
        if (
          h.type === "task_execution" &&
          h.taskId === event.taskId &&
          h.status === "running"
        ) {
          return {
            ...h,
            metadata: { ...h.metadata, ...event.metadata },
          } as WorkflowHistoryEntry<TTaskOutputs, TStateId>;
        }
        return h;
      });
      return {
        state: { ...state, history },
        commands: [],
      };
    }

    case "task_completed": {
      const newOutputs = {
        ...state.taskOutputs,
        [event.taskId]: {
          status: "success" as const,
          output: event.output,
        },
      } as Partial<TaskOutputMap<TTaskOutputs>>;

      const history = state.history.map((h) => {
        if (
          h.type === "task_execution" &&
          h.taskId === event.taskId &&
          h.status === "running"
        ) {
          return {
            ...h,
            status: "success" as const,
            output: event.output,
            finishedAt: new Date().toISOString(),
          } as WorkflowHistoryEntry<TTaskOutputs, TStateId>;
        }
        return h;
      });

      const newState: WorkflowItemState<TTaskOutputs, TStateId, TItemState> = {
        ...state,
        taskOutputs: newOutputs,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        history,
      };

      const transition = evaluateAutoTransitions(
        states,
        newState.currentState,
        newState
      );
      if (transition) {
        const transitionEntry: WorkflowHistoryEntry<TTaskOutputs, TStateId> = {
          type: "state_transition",
          fromState: newState.currentState,
          toState: transition,
          timestamp: new Date().toISOString(),
        };
        const nextState = {
          ...newState,
          currentState: transition,
          history: [...newState.history, transitionEntry],
        };
        return {
          state: nextState,
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

      const history = state.history.map((h) => {
        if (
          h.type === "task_execution" &&
          h.taskId === event.taskId &&
          h.status === "running"
        ) {
          return {
            ...h,
            status: "error" as const,
            error: event.error,
            finishedAt: new Date().toISOString(),
          } as WorkflowHistoryEntry<TTaskOutputs, TStateId>;
        }
        return h;
      });

      const newState: WorkflowItemState<TTaskOutputs, TStateId, TItemState> = {
        ...state,
        taskOutputs: newOutputs,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        history,
      };

      const transition = evaluateAutoTransitions(
        states,
        newState.currentState,
        newState
      );
      if (transition) {
        const transitionEntry: WorkflowHistoryEntry<TTaskOutputs, TStateId> = {
          type: "state_transition",
          fromState: newState.currentState,
          toState: transition,
          timestamp: new Date().toISOString(),
        };
        const nextState = {
          ...newState,
          currentState: transition,
          history: [...newState.history, transitionEntry],
        };
        return {
          state: nextState,
          commands: [{ type: "start_auto_tasks" }],
        };
      }

      return { state: newState, commands: [] };
    }

    case "task_cancelled": {
      const history = state.history.map((h) => {
        if (
          h.type === "task_execution" &&
          h.taskId === event.taskId &&
          h.status === "running"
        ) {
          return {
            ...h,
            status: "cancelled" as const,
            finishedAt: new Date().toISOString(),
          } as WorkflowHistoryEntry<TTaskOutputs, TStateId>;
        }
        return h;
      });

      return {
        state: {
          ...state,
          hasRunningTask: false,
          runningTaskId: null,
          runningTaskContext: null,
          history,
        },
        commands: [],
      };
    }
  }
}

// === Helpers ===

function evaluateAutoTransitions<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
>(
  states: readonly StateDef<TTaskOutputs, TStateId, TItemState>[],
  currentState: TStateId,
  state: WorkflowItemState<TTaskOutputs, TStateId, TItemState>
): TStateId | undefined {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.autoTransitions) return undefined;

  const ctx = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    itemState: state.itemState,
  };

  for (const at of stateDef.autoTransitions) {
    if (at.gate(ctx)) {
      return at.to;
    }
  }

  return undefined;
}
