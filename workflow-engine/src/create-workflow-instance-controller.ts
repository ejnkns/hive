import { getAvailableActions } from "./get-available-actions";
import { reduce, type WorkflowEvent } from "./reduce";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import type {
  RunningTaskContext,
  RuntimeStateDef,
  RuntimeWorkflowConfig,
  VisibleAction,
} from "./workflow-types";

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`No runner registered for role "${role}"`);
    this.name = "UnknownRoleError";
  }
}

export type WorkflowInstanceEvent =
  | {
      type: "state_changed";
      state: RuntimeWorkflowInstanceState;
    }
  | { type: "available_actions_changed"; actions: VisibleAction[] }
  | { type: "task_started"; taskId: string }
  | { type: "task_completed"; taskId: string; output: unknown }
  | { type: "task_errored"; taskId: string; error: string };

type EventHandler = (event: WorkflowInstanceEvent) => void;

export type WorkflowInstanceControllerAPI = {
  getState(): RuntimeWorkflowInstanceState;
  getAvailableActions(): VisibleAction[];
  on(handler: EventHandler): () => void;
  dispatchAction(actionId: string): void;
  startTask(taskId: string, metadata?: Record<string, unknown>): Promise<void>;
  sendTaskInput(taskId: string, content: string, role: string): void;
  patchRunningTaskMetadata(metadata: Record<string, unknown>): void;
  patchWorkflowInstanceState(patch: Record<string, unknown>): void;
  onTaskCompleted(taskId: string, output: unknown): Promise<void>;
  onTaskErrored(taskId: string, error: string): Promise<void>;
  cancel(): void;
  startAutoTasks(): Promise<void>;
};

// === Factory ===

export function createWorkflowInstanceController(
  workflow: RuntimeWorkflowConfig,
  runners: Record<string, TaskRunner>,
  initialState?: RuntimeWorkflowInstanceState,
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[],
  flowState?: Record<string, unknown>
): WorkflowInstanceControllerAPI {
  let state: RuntimeWorkflowInstanceState = initialState ?? {
    currentState: workflow.initial,
    taskOutputs: {},
    hasRunningTask: false,
    runningTaskId: null,
    runningTaskContext: null,
    workflowInstanceState: {},
    history: [],
  };

  let runningRunner: TaskRunner | null = null;
  const handlers: EventHandler[] = [];

  function emit(event: WorkflowInstanceEvent): void {
    for (const handler of handlers) {
      handler(event);
    }
  }

  function dispatcher(event: WorkflowEvent): void {
    const result = reduce(
      state,
      event,
      workflow.states,
      flowState,
      workflowInstancesInState
    );
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
      workflow.states,
      state.currentState,
      state,
      workflowInstancesInState
    );
  }

  async function executeTask(
    task: TaskDefinition,
    metadata?: Record<string, unknown>
  ): Promise<void> {
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
      taskId: task.id,
      context: buildRunningContext(task.role),
      metadata,
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
      taskId,
      output,
    });
  }

  async function onTaskErrored(taskId: string, error: string): Promise<void> {
    dispatcher({
      type: "task_errored",
      taskId,
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

  async function startTask(
    taskId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (state.hasRunningTask) return;
    const stateDef = workflow.states.find((s) => s.id === state.currentState);
    const taskDef = stateDef?.tasks?.find((t) => t.id === taskId);
    if (!taskDef) return;

    await executeTask(taskDef, metadata);
  }

  function patchRunningTaskMetadata(metadata: Record<string, unknown>): void {
    if (!state.hasRunningTask || !state.runningTaskId) return;
    dispatcher({
      type: "task_metadata_patched",
      taskId: state.runningTaskId,
      metadata,
    });
  }

  function sendTaskInput(taskId: string, content: string, role: string): void {
    if (!state.hasRunningTask || state.runningTaskId !== taskId) return;
    runningRunner?.sendMessage?.(content, role);
  }

  function patchWorkflowInstanceState(patch: Record<string, unknown>): void {
    state = {
      ...state,
      workflowInstanceState: { ...state.workflowInstanceState, ...patch },
    };
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

      if (
        action.maxWorkflowInstancesInTarget !== undefined &&
        workflowInstancesInState
      ) {
        const count = workflowInstancesInState(action.transitionTo).length;
        if (count >= action.maxWorkflowInstancesInTarget) return;
      }

      if (action.dependsOnState !== undefined && workflowInstancesInState) {
        const dependees = readDependsOn(state.workflowInstanceState);
        if (dependees.length > 0) {
          const inStateIds = new Set(
            workflowInstancesInState(action.dependsOnState).map(
              (instance) => instance.id
            )
          );
          const allMet = dependees.every((d) => inStateIds.has(d));
          if (!allMet) return;
        }
      }

      if (state.hasRunningTask) {
        runningRunner?.cancel();
        runningRunner = null;
      }

      dispatcher({
        type: "action_triggered",
        actionId,
        transitionTo: action.transitionTo,
      });
    },
    startTask,
    sendTaskInput,
    patchRunningTaskMetadata,
    patchWorkflowInstanceState,
    onTaskCompleted,
    onTaskErrored,
    cancel,
    startAutoTasks,
  };
}

// === Helpers ===

// dependsOn is written into workflowInstanceState by the flow edges /
// callers as a string[]; it is not part of the domain type contract.
function readDependsOn(itemState: Record<string, unknown>): string[] {
  const raw = itemState["dependsOn"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
