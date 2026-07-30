export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  systemPrompt?: string;
  completionTool?: string;
  workspacePath?: string;
};

export type TaskRunner = {
  run(task: TaskDefinition): Promise<{ output: unknown }>;
  cancel(): void;
  sendMessage?(content: string, role: string): Promise<void>;
};
