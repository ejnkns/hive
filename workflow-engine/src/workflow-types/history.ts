/** @private — the workflow-instance history entry types. */

import type { RunningTaskContext } from "./core.ts";

// --- History entries ---

export type TaskExecutionEntry<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: "task_execution";
  taskId: keyof TTaskOutputs & string;
  attempt: number;
  status: "running" | "success" | "error" | "cancelled";
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  context?: RunningTaskContext | null;
  metadata?: Record<string, unknown>;
};

export type StateTransitionEntry<TStateId extends string = string> = {
  type: "state_transition";
  fromState: TStateId;
  toState: TStateId;
  timestamp: string;
  actionId?: string;
};

export type WorkflowHistoryEntry<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
> = TaskExecutionEntry<TTaskOutputs> | StateTransitionEntry<TStateId>;
