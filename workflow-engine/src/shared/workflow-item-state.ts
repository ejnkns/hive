import type {
  RunningTaskContext,
  TaskOutputMap,
  WorkflowHistoryEntry,
} from "../workflow-types";

export type WorkflowItemState<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  currentState: TStateId;
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskId: (keyof TTaskOutputs & string) | null;
  runningTaskContext: RunningTaskContext | null;
  itemState: TItemState;
  history: WorkflowHistoryEntry<TTaskOutputs, TStateId>[];
};
