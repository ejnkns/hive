export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  operationInputs?: Record<string, unknown>;
  systemPrompt?: string;
  completionTool?: string;
  completionSignal?: string;
  workspacePath?: string;
};

export type TaskRunner = {
  run(task: TaskDefinition): Promise<{ output: unknown }>;
  cancel(): void;
  sendMessage?(content: string, role: string): Promise<void>;
};

// Runners that hold per-session mutable state (messages, abort signal) must
// be created per task execution so concurrent tasks in the same flow do not
// share state. A factory produces an isolated instance for each execution.
//
// The factory receives the task's runtime context — flow config and the
// workflow instance it belongs to — so deterministic operation tasks can read
// and patch flow state, and ai runners know which instance they serve.
export type TaskRunnerContext = {
  flowConfig: Record<string, unknown>;
  patchFlowConfig(patch: Record<string, unknown>): void;
  instanceId: string;
  workflowId: string;
  currentState: string;
  workflowInstanceState: Record<string, unknown>;
  patchWorkflowInstanceState(patch: Record<string, unknown>): void;
};

export type TaskRunnerFactory = (ctx: TaskRunnerContext) => TaskRunner;
