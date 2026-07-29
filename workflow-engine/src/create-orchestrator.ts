import { getAvailableActions } from "./get-available-actions";
import { reduce, type WorkflowEvent } from "./reduce";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import type { WorkflowConfig, WorkflowItemState } from "./workflow-state";
import type { RunningTaskContext } from "./workflow-types";

// === Error ===

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`No runner registered for role "${role}"`);
    this.name = "UnknownRoleError";
  }
}

// === Events ===

export type OrchestratorEvent<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> =
  | {
      type: "state_changed";
      state: WorkflowItemState<TTaskOutputs, TStateId>;
    }
  | {
      type: "available_actions_changed";
      actions: { id: string; label: string }[];
    }
  | {
      type: "task_started";
      taskId: string;
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
    };

type EventHandler = (event: OrchestratorEvent<any, any>) => void;

// === Public API ===

export type OrchestratorAPI<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  getState(): WorkflowItemState<TTaskOutputs, TStateId>;
  getAvailableActions(): { id: string; label: string }[];
  on(handler: EventHandler): () => void;
  dispatchAction(actionId: string): void;
  onTaskCompleted(taskId: string, output: unknown): Promise<void>;
  onTaskErrored(taskId: string, error: string): Promise<void>;
  cancel(): void;
  startAutoTasks(): Promise<void>;
};

// === Factory ===

export function createOrchestrator<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
>(
  workflow: WorkflowConfig<TTaskOutputs, TStateId>,
  runners: Record<string, TaskRunner>,
  initialState?: WorkflowItemState<TTaskOutputs, TStateId>
): OrchestratorAPI<TTaskOutputs, TStateId> {
  let state: WorkflowItemState<TTaskOutputs, TStateId> = initialState ?? {
    currentState: workflow.initial,
    taskOutputs: {} as Partial<any>,
    hasRunningTask: false,
    runningTaskId: null,
    runningTaskContext: null,
  };

  let runningRunner: TaskRunner | null = null;
  const handlers: EventHandler[] = [];

  function emit(event: OrchestratorEvent<TTaskOutputs, TStateId>): void {
    for (const handler of handlers) {
      handler(event);
    }
  }

  function dispatcher(event: WorkflowEvent<TTaskOutputs, TStateId>): void {
    const result = reduce(state, event, workflow.states);
    state = result.state;
    emit({ type: "state_changed", state });
    emit({
      type: "available_actions_changed",
      actions: getVisibleActions(),
    });

    if (event.type === "task_started") {
      emit({
        type: "task_started",
        taskId: (event as any).taskId,
      });
    }

    if (result.commands.some((c) => c.type === "start_auto_tasks")) {
      startAutoTasks();
    }
  }

  function getVisibleActions(): { id: string; label: string }[] {
    return getAvailableActions(
      workflow.states as readonly any[],
      state.currentState,
      state as any
    );
  }

  async function runTask(task: TaskDefinition): Promise<void> {
    const runner = runners[task.role];
    if (!runner) {
      emit({
        type: "task_errored",
        taskId: task.id,
        error: `No runner for role "${task.role}"`,
      });
      return;
    }

    runningRunner = runner;

    dispatcher({
      type: "task_started",
      taskId: task.id as keyof TTaskOutputs & string,
      context: buildRunningContext(task.role),
    });

    try {
      const { output } = await runner.run(task, {});
      runningRunner = null;
      await onTaskCompleted(task.id, output);
    } catch (err: unknown) {
      runningRunner = null;
      const msg = err instanceof Error ? err.message : String(err);
      await onTaskErrored(task.id, msg);
    }
  }

  async function onTaskCompleted(
    taskId: string,
    output: unknown
  ): Promise<void> {
    dispatcher({
      type: "task_completed",
      taskId: taskId as keyof TTaskOutputs & string,
      output,
    });
  }

  async function onTaskErrored(taskId: string, error: string): Promise<void> {
    dispatcher({
      type: "task_errored",
      taskId: taskId as keyof TTaskOutputs & string,
      error,
    });
  }

  function cancel(): void {
    if (!state.hasRunningTask || !state.runningTaskId) return;

    runningRunner?.cancel();
    dispatcher({
      type: "task_cancelled",
      taskId: state.runningTaskId,
    });
  }

  async function startAutoTasks(): Promise<void> {
    const stateDef = workflow.states.find((s) => s.id === state.currentState);
    const autoTasks = stateDef?.tasks?.filter((t) => t.trigger === "auto");
    if (!autoTasks?.length) return;

    for (const task of autoTasks) {
      await runTask(task);
    }
  }

  function buildRunningContext(role: string): RunningTaskContext | null {
    if (role === "ai-task") return { role: "ai-task", messages: [] };
    if (role === "ai-chat")
      return {
        role: "ai-chat",
        messages: [],
        sessionId: crypto.randomUUID(),
      };
    if (role === "operation") return { role: "operation" };
    return null;
  }

  return {
    getState: () => state,
    getAvailableActions: getVisibleActions,
    on: (handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    dispatchAction: (actionId: string) => {
      const stateDef = workflow.states.find((s) => s.id === state.currentState);
      if (!stateDef) return;

      const action = stateDef.actions?.find((a) => a.id === actionId);
      if (!action) return;

      const { transitionTo } = action.effect();
      dispatcher({
        type: "action_triggered",
        actionId,
        transitionTo,
      });
    },
    onTaskCompleted,
    onTaskErrored,
    cancel,
    startAutoTasks,
  };
}
