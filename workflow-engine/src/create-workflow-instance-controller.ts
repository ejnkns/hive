import { dependsOnMet, getAvailableActions } from "./get-available-actions";
import { readFlowSettings } from "./read-flow-settings";
import { reduce, type WorkflowEvent } from "./reduce";
import { persistOutput } from "./runners/persist-output";
import { discardIsolatedWorkspace } from "./runners/prepare-isolated-workspace";
import { readWorkflowAttempt } from "./shared/read-workflow-attempt";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state";
import type {
  TaskDefinition,
  TaskRunner,
  TaskRunnerContext,
  TaskRunnerFactory,
} from "./task-runner";
import type {
  ChatMessage,
  RunningTaskContext,
  RuntimeWorkflowConfig,
  VisibleAction,
} from "./workflow-types";

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
  id: string;
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

// Runtime-level context the controller threads into every task runner factory
// invocation: flow config access, the instance's identity, and the flow's
// instance-creation capability (so an agent tool can spawn fresh instances).
export type ControllerRuntimeContext = {
  flowConfig: Record<string, unknown>;
  patchFlowConfig(patch: Record<string, unknown>): void;
  instanceId: string;
  workflowId: string;
  createWorkflowInstance: (
    workflowId: string,
    instanceState?: Record<string, unknown>
  ) => { id: string };
};

export function createWorkflowInstanceController(
  workflow: RuntimeWorkflowConfig,
  runners: Record<string, TaskRunnerFactory>,
  initialState?: RuntimeWorkflowInstanceState,
  workflowInstancesInState?: (stateId?: string) => {
    currentState: string;
    id: string;
    workflowInstanceState: Record<string, unknown>;
  }[],
  flowState?: Record<string, unknown>,
  runtimeContext?: ControllerRuntimeContext
): WorkflowInstanceControllerAPI {
  const taskContext = {
    flowConfig: runtimeContext?.flowConfig ?? {},
    patchFlowConfig:
      runtimeContext?.patchFlowConfig ??
      ((_patch: Record<string, unknown>) => {
        /* no runtime bound */
      }),
    instanceId: runtimeContext?.instanceId ?? "",
    workflowId: runtimeContext?.workflowId ?? "",
    createWorkflowInstance:
      runtimeContext?.createWorkflowInstance ??
      (() => {
        throw new Error("createWorkflowInstance requires a flow runtime");
      }),
  };
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
      workflowInstancesInState,
      flowState,
      workflow.instance?.title
    );
  }

  async function executeTask(
    task: TaskDefinition,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const createRunner = runners[task.role];
    if (!createRunner) {
      emit({
        type: "task_errored",
        taskId: task.id,
        error: `No runner for role "${task.role}"`,
      });
      return;
    }

    // A fresh runner per execution isolates session state (messages, abort
    // signal) so concurrent tasks in the same flow do not clobber each other.
    const runner = createRunner(buildTaskRunnerContext());
    runningRunner = runner;

    dispatcher({
      type: "task_started",
      taskId: task.id,
      context: buildRunningContext(task),
      metadata,
    });

    try {
      const { output } = await runner.run(task);
      runningRunner = null;
      persistTaskOutput(task, output);
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

  // Declared persist paths write the task output to the flow's domain root on
  // successful completion. Without a bound base path there is nowhere to write
  // and persistence is a no-op; a failed write surfaces as a task error.
  function persistTaskOutput(task: TaskDefinition, output: unknown): void {
    if (!task.persist) return;
    const settings = readFlowSettings(taskContext.flowConfig);
    if (!settings.basePath || !settings.domainDir) return;
    persistOutput({
      output,
      persistPath: task.persist.path,
      basePath: settings.basePath,
      domainDir: settings.domainDir,
      instanceId: taskContext.instanceId,
      attempt: readWorkflowAttempt(state.workflowInstanceState),
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

  // The engine-provided attempt bookkeeping behind ManualAction.newAttempt:
  // increment the counter (readWorkflowAttempt defaults an unwritten counter
  // to 1, so the first declared attempt starts at 2) and discard the
  // abandoned workspace. The old attempt's branch and persisted artifacts
  // stay — attempts remain identifiable.
  function advanceAttempt(): void {
    const nextAttempt = readWorkflowAttempt(state.workflowInstanceState) + 1;
    const oldWorktree = state.workflowInstanceState.worktreePath;
    patchWorkflowInstanceState({ attempt: nextAttempt });
    if (typeof oldWorktree === "string" && oldWorktree !== "") {
      discardIsolatedWorkspace(
        oldWorktree,
        readFlowSettings(taskContext.flowConfig).basePath
      );
    }
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

  // The ai-chat runner keeps its conversation locally; this syncs the latest
  // transcript into the instance state and emits a state_changed so observers
  // (the flow snapshot push) see each message as it arrives. No-op when no
  // chat session is running.
  function patchRunningTaskMessages(messages: ChatMessage[]): void {
    if (!state.hasRunningTask || !state.runningTaskContext) return;
    if (state.runningTaskContext.role === "operation") return;
    state = {
      ...state,
      runningTaskContext: { ...state.runningTaskContext, messages },
    };
    emit({ type: "state_changed", state });
  }

  function buildRunningContext(
    task: TaskDefinition
  ): RunningTaskContext | null {
    if (task.role === "ai-task") return { role: "ai-task", messages: [] };
    if (task.role === "ai-chat")
      return {
        role: "ai-chat",
        messages: [],
        sessionId: crypto.randomUUID(),
        // HITL sessions (startOnUserInput) accept user messages; one-shot
        // agents (cards worker, research) are read-only in the UI.
        interactive: task.startOnUserInput === true,
      };
    if (task.role === "operation") return { role: "operation" };
    return null;
  }

  function buildTaskRunnerContext(): TaskRunnerContext {
    return {
      ...taskContext,
      currentState: state.currentState,
      workflowInstanceState: state.workflowInstanceState,
      patchWorkflowInstanceState: patchWorkflowInstanceState,
      taskOutputs: state.taskOutputs,
      patchRunningTaskMessages,
      createWorkflowInstance: taskContext.createWorkflowInstance,
      workflowInstancesInState: (stateId) =>
        workflowInstancesInState?.(stateId) ?? [],
    };
  }

  return {
    get id() {
      return taskContext.instanceId;
    },
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
        if (
          !dependsOnMet(
            dependees,
            workflowInstancesInState(action.dependsOnState),
            workflow.instance?.title
          )
        ) {
          return;
        }
      }

      // newAttempt: this action starts a fresh attempt — the engine bumps the
      // instance's attempt counter (so the next prepare_worktree/persist-path
      // runs under attempt-N) and discards the abandoned workspace recorded in
      // worktreePath. Declared on the action, owned by the engine.
      if (action.newAttempt === true) {
        advanceAttempt();
      }

      if (
        action.completesRunningTask &&
        state.hasRunningTask &&
        state.runningTaskId &&
        state.runningTaskContext?.role === "ai-chat"
      ) {
        const completedTaskId = state.runningTaskId;
        const output = { messages: state.runningTaskContext.messages };
        dispatcher({
          type: "action_triggered",
          actionId,
          transitionTo: action.transitionTo,
          completedTask: { taskId: completedTaskId, output },
        });
        // The completion is recorded before the runner is released, so the
        // runner's run() rejection is swallowed by executeTask's early return
        // once hasRunningTask is false.
        runningRunner?.cancel();
        runningRunner = null;
        return;
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
  const raw = itemState.dependsOn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
