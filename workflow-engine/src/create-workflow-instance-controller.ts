import { collectConfigFieldValues } from "./collect-config-field-values.ts";
import { getAvailableActions } from "./get-available-actions.ts";
import { readFlowSettings, resolveFlowRoot } from "./read-flow-settings.ts";
import { reduce, type WorkflowEvent } from "./reduce.ts";
import { persistOutput } from "./runners/persist-output.ts";
import { discardIsolatedWorkspace } from "./runners/prepare-isolated-workspace.ts";
import { readWorkflowAttempt } from "./shared/read-workflow-attempt.ts";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state.ts";
import type {
  TaskDefinition,
  TaskRunner,
  TaskRunnerContext,
  TaskRunnerFactory,
  WorkflowInstancesInState,
} from "./task-runner.ts";
import type {
  ChatMessage,
  ConfigField,
  ModelCallStatus,
  RunningTaskContext,
  RuntimeWorkflowConfig,
  VisibleAction,
} from "./workflow-types.ts";

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
  // The workflow's declared editable instance-state fields (WorkflowConfig
  // editFields). The server validates instance-edit payloads against these
  // before patching state; empty when the workflow is not editable.
  getEditFields(): ConfigField[];
  on(handler: EventHandler): () => void;
  dispatchAction(actionId: string, payload?: Record<string, unknown>): void;
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
// invocation: flow config access, the instance's identity, the flow's
// instance-creation capability (so an agent tool can spawn fresh instances),
// and the cross-instance write capability (E1 — an operation on this instance
// patches a sibling instance's state).
export type ControllerRuntimeContext = {
  flowConfig: Record<string, unknown>;
  instanceId: string;
  workflowId: string;
  createWorkflowInstance: (
    workflowId: string,
    instanceState?: Record<string, unknown>,
    stateId?: string
  ) => { id: string };
  patchSiblingInstanceState?: (
    instanceId: string,
    patch: Record<string, unknown>
  ) => boolean;
  // E5: removes THIS instance from the flow (called when a deletesInstance
  // action fires). Absent when the controller is not runtime-bound.
  removeInstance?: () => void;
  // E2: flow-level state access — a live getter plus the flowState write
  // (the runtime's patchFlowState persists and emits flow_state_changed).
  flowState?: () => Record<string, unknown>;
  patchFlowState?: (patch: Record<string, unknown>) => void;
};

export function createWorkflowInstanceController(
  workflow: RuntimeWorkflowConfig,
  runners: Record<string, TaskRunnerFactory>,
  initialState?: RuntimeWorkflowInstanceState,
  workflowInstancesInState?: WorkflowInstancesInState,
  flowState?: Record<string, unknown>,
  runtimeContext?: ControllerRuntimeContext
): WorkflowInstanceControllerAPI {
  const taskContext = {
    flowConfig: runtimeContext?.flowConfig ?? {},
    instanceId: runtimeContext?.instanceId ?? "",
    workflowId: runtimeContext?.workflowId ?? "",
    createWorkflowInstance:
      runtimeContext?.createWorkflowInstance ??
      (() => {
        throw new Error("createWorkflowInstance requires a flow runtime");
      }),
    patchSiblingInstanceState: runtimeContext?.patchSiblingInstanceState,
    removeInstance: runtimeContext?.removeInstance,
    flowState: runtimeContext?.flowState,
    patchFlowState: runtimeContext?.patchFlowState,
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
  // successful completion. basePath/domainDir are guaranteed by creation
  // (the server normalizes basePath and copies the definition's domainDir
  // into the config), so a missing binding is a hard error, not a silent
  // skip — the flow declared this persist path, it must land.
  function persistTaskOutput(task: TaskDefinition, output: unknown): void {
    if (!task.persist) return;
    const settings = readFlowSettings(taskContext.flowConfig);
    if (!settings.domainDir) {
      throw new Error("Flow config domainDir is not set");
    }
    persistOutput({
      output,
      persistPath: task.persist.path,
      basePath: resolveFlowRoot(taskContext.flowConfig),
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

  function patchRunningTaskStatus(status: ModelCallStatus): void {
    if (!state.hasRunningTask || !state.runningTaskContext) return;
    if (state.runningTaskContext.role === "operation") return;
    state = {
      ...state,
      runningTaskContext: { ...state.runningTaskContext, modelStatus: status },
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
      workflowInstanceState: () => state.workflowInstanceState,
      patchWorkflowInstanceState: patchWorkflowInstanceState,
      taskOutputs: state.taskOutputs,
      patchRunningTaskMessages,
      patchRunningTaskStatus,
      createWorkflowInstance: taskContext.createWorkflowInstance,
      workflowInstancesInState: (workflowId, stateId) =>
        workflowInstancesInState?.(workflowId, stateId) ?? [],
      patchSiblingInstanceState:
        taskContext.patchSiblingInstanceState ??
        (() => {
          throw new Error("patchSiblingInstanceState requires a flow runtime");
        }),
      flowState: () => taskContext.flowState?.() ?? flowState ?? {},
      patchFlowState:
        taskContext.patchFlowState ??
        ((_patch: Record<string, unknown>) => {
          /* no runtime bound */
        }),
    };
  }

  return {
    get id() {
      return taskContext.instanceId;
    },
    getState: () => state,
    getAvailableActions: getVisibleActions,
    getEditFields: () => workflow.editFields ?? [],
    on: (handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    dispatchAction: (actionId: string, payload?: Record<string, unknown>) => {
      // The gate is part of the availability contract: a directly-dispatched
      // action must be one the UI would show right now (gate + dependsOnState
      // evaluated through the same getVisibleActions path). Programmatic
      // dispatch must not bypass what the user sees — the engine's
      // flow-level dispatchToAll already filters through availableActions,
      // and this closes the same hole for direct callers.
      const visible = getVisibleActions();
      if (!visible.some((action) => action.id === actionId)) return;

      const stateDef = workflow.states.find((s) => s.id === state.currentState);
      const action = stateDef?.actions?.find((a) => a.id === actionId);
      if (!action) return;

      // An action with declared fields collects user input: validate the
      // payload and write the accepted values into the acting instance's
      // workflowInstanceState before the transition, so the note/reason/date
      // travels with the action.
      if (action.fields !== undefined) {
        const collected = collectConfigFieldValues(
          action.fields,
          payload ?? {}
        );
        if (!collected.ok) {
          throw new Error(collected.error);
        }
        patchWorkflowInstanceState(collected.values);
      }

      // E5 — deletesInstance: the destructive action removes this instance
      // from the flow; there is no transition target. The runtime callback
      // drops the controller, deletes its persisted state, and notifies
      // listeners; the dispatch ends here.
      if (action.deletesInstance === true) {
        if (taskContext.removeInstance === undefined) {
          throw new Error(
            "deletesInstance action requires a flow runtime (removeInstance is not bound)"
          );
        }
        taskContext.removeInstance();
        return;
      }

      // A non-deletion action always carries a transition target (the
      // validator + compile step guarantee it); the runtime type keeps it
      // optional so deletesInstance actions can omit it.
      if (action.transitionTo === undefined) return;

      if (
        action.maxWorkflowInstancesInTarget !== undefined &&
        workflowInstancesInState
      ) {
        const count = workflowInstancesInState(
          undefined,
          action.transitionTo
        ).length;
        if (count >= action.maxWorkflowInstancesInTarget) return;
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
