import type {
  RunningTaskContext,
  TaskOutputMap,
  WorkflowHistoryEntry,
} from "../workflow-types.ts";

export type WorkflowInstanceState<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  currentState: TStateId;
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskId: (keyof TTaskOutputs & string) | null;
  runningTaskContext: RunningTaskContext | null;
  workflowInstanceState: TWorkflowInstanceState;
  history: WorkflowHistoryEntry<TTaskOutputs, TStateId>[];
  // Consecutive error count per task id: incremented when a task errors,
  // reset when that task succeeds. Exposed to gates as ctx.taskErrorCounts so
  // definitions can bound retry loops declaratively (e.g. "escalate after 3
  // failed validations") without the engine knowing what a task does.
  taskErrorCounts?: Record<string, number>;
};

// Erased instantiation used inside the engine for heterogeneous instances.
export type RuntimeWorkflowInstanceState = WorkflowInstanceState;
