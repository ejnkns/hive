import type {
  WorkflowCommand,
  WorkflowConfig,
  WorkflowEvent,
  WorkflowItemState,
} from "./reducer";
import { getAvailableActions, reduce } from "./reducer";
import type {
  ChatMessage,
  RunningTaskContext,
  StateDef,
} from "./workflow-types";

// === Task runner interface ===

// A TaskRunner executes a task with the given configuration and returns
// the outcome. Each role (ai-task, ai-chat, operation) has its own
// runner implementation.
export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  systemPrompt?: string;
};

export type TaskContext = Record<string, never>;

export interface TaskRunner {
  run(task: TaskDefinition, context: TaskContext): Promise<{ output: unknown }>;
  cancel(): void;
}

// === Runner not found error ===

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`No runner registered for role "${role}"`);
    this.name = "UnknownRoleError";
  }
}

// === Orchestrator events ===

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

// === Orchestrator ===

// Manages the lifecycle of a single workflow item. Wraps the pure reducer
// and provides the side-effect management (task execution, cancellation).
export class WorkflowOrchestrator<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> {
  private workflow: WorkflowConfig<TTaskOutputs, TStateId>;
  private state: WorkflowItemState<TTaskOutputs, TStateId>;
  private runners: Map<string, TaskRunner>;
  private runningRunner: TaskRunner | null;
  private handlers: EventHandler[];

  constructor(
    workflow: WorkflowConfig<TTaskOutputs, TStateId>,
    runners: Record<string, TaskRunner>,
    initialState?: WorkflowItemState<TTaskOutputs, TStateId>
  ) {
    this.workflow = workflow;
    this.state = initialState ?? {
      currentState: workflow.initial,
      taskOutputs: {} as Partial<any>,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    this.runners = new Map(Object.entries(runners));
    this.runningRunner = null;
    this.handlers = [];
  }

  getState(): WorkflowItemState<TTaskOutputs, TStateId> {
    return this.state;
  }

  getAvailableActions(): { id: string; label: string }[] {
    return getAvailableActions(
      this.workflow.states as readonly StateDef<any, any>[],
      this.state.currentState,
      this.state as WorkflowItemState<any, any>
    );
  }

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  private emit(event: OrchestratorEvent<TTaskOutputs, TStateId>): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  // Dispatch a user-triggered action
  dispatchAction(actionId: string): void {
    const stateDef = this.workflow.states.find(
      (s) => s.id === this.state.currentState
    );
    if (!stateDef) return;

    const action = stateDef.actions?.find((a) => a.id === actionId);
    if (!action) return;

    const { transitionTo } = action.effect();
    this.processEvent({
      type: "action_triggered",
      actionId,
      transitionTo,
    });
  }

  // Called by the consumer when a task completes
  async onTaskCompleted(taskId: string, output: unknown): Promise<void> {
    this.processEvent({
      type: "task_completed",
      taskId: taskId as keyof TTaskOutputs & string,
      output,
    });
  }

  // Called by the consumer when a task errors
  async onTaskErrored(taskId: string, error: string): Promise<void> {
    this.processEvent({
      type: "task_errored",
      taskId: taskId as keyof TTaskOutputs & string,
      error,
    });
  }

  // Cancel the currently running task
  cancel(): void {
    if (!this.state.hasRunningTask || !this.state.runningTaskId) return;

    this.runningRunner?.cancel();
    this.processEvent({
      type: "task_cancelled",
      taskId: this.state.runningTaskId,
    });
  }

  // Start any auto-triggered tasks for the current state
  async startAutoTasks(): Promise<void> {
    const stateDef = this.workflow.states.find(
      (s) => s.id === this.state.currentState
    );
    const autoTasks = stateDef?.tasks?.filter((t) => t.trigger === "auto");
    if (!autoTasks?.length) return;

    for (const task of autoTasks) {
      await this.runTask(task);
    }
  }

  private async runTask(task: TaskDefinition): Promise<void> {
    const runner = this.runners.get(task.role);
    if (!runner) {
      this.emit({
        type: "task_errored",
        taskId: task.id,
        error: `No runner for role "${task.role}"`,
      });
      return;
    }

    this.runningRunner = runner;

    this.processEvent({
      type: "task_started",
      taskId: task.id as keyof TTaskOutputs & string,
      context: this.buildRunningContext(task.role),
    });

    try {
      const { output } = await runner.run(task, {});
      this.runningRunner = null;
      await this.onTaskCompleted(task.id, output);
    } catch (err: unknown) {
      this.runningRunner = null;
      const msg = err instanceof Error ? err.message : String(err);
      await this.onTaskErrored(task.id, msg);
    }
  }

  private processEvent(event: WorkflowEvent<TTaskOutputs, TStateId>): void {
    const result = reduce(this.state, event, this.workflow.states);

    this.state = result.state;
    this.emit({ type: "state_changed", state: this.state });
    this.emit({
      type: "available_actions_changed",
      actions: this.getAvailableActions(),
    });

    if (event.type === "task_started") {
      this.emit({
        type: "task_started",
        taskId: (event as any).taskId,
      });
    }

    if (result.commands.some((c) => c.type === "start_auto_tasks")) {
      this.startAutoTasks();
    }
  }

  private buildRunningContext(role: string): RunningTaskContext | null {
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
}
