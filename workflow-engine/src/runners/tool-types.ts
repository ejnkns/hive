/** @public — shared types for the built-in runners subtree. Import within runners/ but not from outside. */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterSchema>;
      required: string[];
    };
  };
};

export type ToolParameterSchema = {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
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

export type ToolContext = {
  workspacePath: string;
  signal?: AbortSignal;
  baseCommit?: string;
  projectRevision?: string;
};

export type ToolExecutor = (
  call: ToolCall,
  ctx: ToolContext
) => Promise<ToolResult>;
