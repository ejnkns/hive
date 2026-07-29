export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  systemPrompt?: string;
};

export type TaskContext = Record<string, never>;

export type TaskRunner = {
  run(task: TaskDefinition, context: TaskContext): Promise<{ output: unknown }>;
  cancel(): void;
};
