import type {
  RunningTaskContext,
  TaskOutputMap,
  WorkflowHistoryEntry,
} from "../workflow-types";

export type WorkflowInstanceState<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    never
  >,
> = {
  currentState: TStateId;
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskId: (keyof TTaskOutputs & string) | null;
  runningTaskContext: RunningTaskContext | null;
  workflowInstanceState: TWorkflowInstanceState;
  history: WorkflowHistoryEntry<TTaskOutputs, TStateId>[];
};
