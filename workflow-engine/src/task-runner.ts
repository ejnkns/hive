export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  systemPrompt?: string;
};

export type TaskRunner = {
  run(task: TaskDefinition): Promise<{ output: unknown }>;
  cancel(): void;
  sendMessage?(message: string): void;
};
