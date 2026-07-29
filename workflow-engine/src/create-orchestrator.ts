import { getAvailableActions } from "./get-available-actions";
import { reduce, type WorkflowEvent } from "./reduce";
import type { WorkflowItemState } from "./shared/workflow-item-state";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import type {
  RunningTaskContext,
  StateDef,
  VisibleAction,
} from "./workflow-types";

type ErasedState = StateDef<
  Record<string, unknown>,
  string,
  Record<string, unknown>
>;
type ErasedItemState = WorkflowItemState<
  Record<string, unknown>,
  string,
  Record<string, unknown>
>;

// === Workflow configuration ===

export type WorkflowConfig<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  id: string;
  label: string;
  description?: string;
  taskOutputs: TTaskOutputs;
  states: readonly StateDef<TTaskOutputs, TStateId, TItemState>[];
  initial: TStateId;
  terminalStates: readonly TStateId[];
};

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`No runner registered for role "${role}"`);
    this.name = "UnknownRoleError";
  }
}

export type OrchestratorEvent<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> =
  | {
      type: "state_changed";
      state: WorkflowItemState<TTaskOutputs, TStateId, TItemState>;
    }
  | { type: "available_actions_changed"; actions: VisibleAction[] }
  | { type: "task_started"; taskId: string }
  | { type: "task_completed"; taskId: string; output: unknown }
  | { type: "task_errored"; taskId: string; error: string };

type EventHandler = (
  event: OrchestratorEvent<Record<string, unknown>, string>
) => void;

export type OrchestratorAPI<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  getState(): WorkflowItemState<TTaskOutputs, TStateId, TItemState>;
  getAvailableActions(): VisibleAction[];
  on(handler: EventHandler): () => void;
  dispatchAction(actionId: string): void;
  startTask(taskId: string): void;
  patchItemState(patch: Partial<TItemState>): void;
  onTaskCompleted(taskId: string, output: unknown): Promise<void>;
  onTaskErrored(taskId: string, error: string): Promise<void>;
  cancel(): void;
  startAutoTasks(): Promise<void>;
};

// === Factory ===

export function createOrchestrator<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
>(
  workflow: WorkflowConfig<TTaskOutputs, TStateId, TItemState>,
  runners: Record<string, TaskRunner>,
  initialState?: WorkflowItemState<TTaskOutputs, TStateId, TItemState>
): OrchestratorAPI<TTaskOutputs, TStateId, TItemState> {
  let state: WorkflowItemState<TTaskOutputs, TStateId, TItemState> =
    initialState ??
    ({
      currentState: workflow.initial,
      taskOutputs: {} as Partial<Record<string, unknown>>,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      itemState: {} as TItemState,
    } as WorkflowItemState<TTaskOutputs, TStateId, TItemState>);

  let runningRunner: TaskRunner | null = null;
  const handlers: EventHandler[] = [];

  function emit(
    event: OrchestratorEvent<TTaskOutputs, TStateId, TItemState>
  ): void {
    for (const handler of handlers) {
      handler(event as OrchestratorEvent<Record<string, unknown>, string>);
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
      emit({ type: "task_started", taskId: event.taskId });
    }

    if (result.commands.some((c) => c.type === "start_auto_tasks")) {
      startAutoTasks();
    }
  }

  function getVisibleActions(): VisibleAction[] {
    return getAvailableActions(
      workflow.states as unknown as readonly ErasedState[],
      state.currentState as string,
      state as unknown as ErasedItemState
    );
  }

  async function executeTask(task: TaskDefinition): Promise<void> {
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
      const { output } = await runner.run(task);
      runningRunner = null;
      await onTaskCompleted(task.id, output);
    } catch (err: unknown) {
      runningRunner = null;
      if (!state.hasRunningTask) return;
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
    dispatcher({ type: "task_cancelled", taskId: state.runningTaskId });
  }

  async function startAutoTasks(): Promise<void> {
    const stateDef = workflow.states.find((s) => s.id === state.currentState);
    const autoTasks = stateDef?.tasks?.filter((t) => t.trigger === "auto");
    if (!autoTasks?.length) return;

    for (const task of autoTasks) {
      await executeTask(task);
    }
  }

  function startTask(taskId: string): void {
    if (state.hasRunningTask) return;
    const stateDef = workflow.states.find((s) => s.id === state.currentState);
    const taskDef = stateDef?.tasks?.find((t) => t.id === taskId);
    if (!taskDef) return;

    dispatcher({
      type: "task_started",
      taskId: taskId as keyof TTaskOutputs & string,
      context: buildRunningContext(taskDef.role),
    });
  }

  function patchItemState(patch: Partial<TItemState>): void {
    state = { ...state, itemState: { ...state.itemState, ...patch } };
    emit({ type: "state_changed", state });
  }

  function buildRunningContext(role: string): RunningTaskContext | null {
    if (role === "ai-task") return { role: "ai-task", messages: [] };
    if (role === "ai-chat")
      return { role: "ai-chat", messages: [], sessionId: crypto.randomUUID() };
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

      if (state.hasRunningTask) {
        runningRunner?.cancel();
        runningRunner = null;
      }

      const { transitionTo } = action.effect();
      dispatcher({
        type: "action_triggered",
        actionId,
        transitionTo: transitionTo as TStateId,
      });
    },
    startTask,
    patchItemState,
    onTaskCompleted,
    onTaskErrored,
    cancel,
    startAutoTasks,
  };
}
