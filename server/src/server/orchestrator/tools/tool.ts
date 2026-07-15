export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
  isError: boolean;
};

export type ToolExecutionContext = {
  sessionId: string;
  workspacePath: string;
};

export type Tool = {
  definition: ToolDefinition;
  execute: (
    toolCall: ToolCall,
    context: ToolExecutionContext
  ) => Promise<ToolResult>;
};

export type ToolRegistry = {
  getDefinitions: () => ToolDefinition[];
  execute: (
    toolCall: ToolCall,
    context: ToolExecutionContext
  ) => Promise<ToolResult>;
};
