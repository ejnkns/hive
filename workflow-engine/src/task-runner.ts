export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  operationInputs?: Record<string, unknown>;
  systemPrompt?: string;
  completionTool?: string;
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
export type TaskRunnerFactory = () => TaskRunner;
