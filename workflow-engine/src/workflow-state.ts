import type {
  RunningTaskContext,
  StateDef,
  TaskOutputMap,
} from "./workflow-types";

export type WorkflowConfig<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  id: string;
  label: string;
  description?: string;
  taskOutputs: TTaskOutputs;
  states: readonly StateDef<TTaskOutputs, TStateId>[];
  initial: TStateId;
  terminalStates: readonly TStateId[];
};

export type WorkflowItemState<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
> = {
  currentState: TStateId;
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskId: (keyof TTaskOutputs & string) | null;
  runningTaskContext: RunningTaskContext | null;
};
