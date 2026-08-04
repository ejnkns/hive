import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state";
import type {
  RunningTaskContext,
  RuntimeGateContext,
  RuntimeStateDef,
  WorkflowHistoryEntry,
} from "./workflow-types";

// === Events ===

export type WorkflowEvent =
  | {
      type: "action_triggered";
      actionId: string;
      transitionTo: string;
      // When set, the dispatched action completes the running task
      // successfully (recording this output) instead of cancelling it.
      // Carried on the event so one reducer case records the completion and
      // transitions, without dispatching task_completed (whose
      // evaluateAutoTransitions could fight the action's transitionTo).
      completedTask?: { taskId: string; output: unknown };
    }
  | {
      type: "task_started";
      taskId: string;
      context: RunningTaskContext | null;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "task_metadata_patched";
      taskId: string;
      metadata: Record<string, unknown>;
    }
  | {
      type: "task_completed";
      taskId: string;
      output: unknown;
    }
  | {
      type: "task_errored";
      taskId: string;
      error: string;
    }
  | {
      type: "task_cancelled";
      taskId: string;
    };

// === Commands emitted to the controller ===

export type WorkflowCommand = { type: "noop" } | { type: "start_auto_tasks" };

// === Reduce result ===

export type ReduceResult = {
  state: RuntimeWorkflowInstanceState;
  commands: WorkflowCommand[];
};

// === Reducer ===

export function reduce(
  state: RuntimeWorkflowInstanceState,
  event: WorkflowEvent,
  states: readonly RuntimeStateDef[],
  flowState?: Record<string, unknown>,
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[]
): ReduceResult {
  switch (event.type) {
    case "action_triggered": {
      const completedTask = event.completedTask;
      const taskOutputs = completedTask
        ? {
            ...state.taskOutputs,
            [completedTask.taskId]: {
              status: "success" as const,
              output: completedTask.output,
            },
          }
        : state.taskOutputs;

      const history = completedTask
        ? state.history.map((h) => {
            if (
              h.type === "task_execution" &&
              h.taskId === completedTask.taskId &&
              h.status === "running"
            ) {
              return {
                ...h,
                status: "success" as const,
                output: completedTask.output,
                finishedAt: new Date().toISOString(),
              };
            }
            return h;
          })
        : state.history;

      const transitionEntry: WorkflowHistoryEntry = {
        type: "state_transition",
        fromState: state.currentState,
        toState: event.transitionTo,
        timestamp: new Date().toISOString(),
        actionId: event.actionId,
      };
      const nextState: RuntimeWorkflowInstanceState = {
        ...state,
        currentState: event.transitionTo,
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        taskOutputs,
        history: [...history, transitionEntry],
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
      const taskEntry: WorkflowHistoryEntry = {
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
          };
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
      };

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
          };
        }
        return h;
      });

      const newState: RuntimeWorkflowInstanceState = {
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
        newState,
        flowState,
        workflowInstancesInState
      );
      if (transition) {
        const transitionEntry: WorkflowHistoryEntry = {
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
      };

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
          };
        }
        return h;
      });

      const newState: RuntimeWorkflowInstanceState = {
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
        newState,
        flowState,
        workflowInstancesInState
      );
      if (transition) {
        const transitionEntry: WorkflowHistoryEntry = {
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
          };
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

function evaluateAutoTransitions(
  states: readonly RuntimeStateDef[],
  currentState: string,
  state: RuntimeWorkflowInstanceState,
  flowState?: Record<string, unknown>,
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[]
): string | undefined {
  const stateDef = states.find((s) => s.id === currentState);
  if (!stateDef?.autoTransitions) return undefined;

  const ctx: RuntimeGateContext = {
    taskOutputs: state.taskOutputs,
    hasRunningTask: state.hasRunningTask,
    runningTaskContext: state.runningTaskContext,
    workflowInstanceState: state.workflowInstanceState,
    flowState: flowState ?? {},
    workflowInstancesInState,
  };

  for (const at of stateDef.autoTransitions) {
    if (at.gate(ctx)) {
      return at.to;
    }
  }

  return undefined;
}
