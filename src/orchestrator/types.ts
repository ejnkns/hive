import type { Message } from "../shared/message";

export type CompletionRequest = {
  payload: Record<string, unknown>;
  sessionId?: string;
};

export type CompletionResponse = {
  status: number;
  ok: boolean;
  body: string;
  provider: string | null;
  model: string | null;
};

export type ModelCaller = {
  complete: (request: CompletionRequest) => Promise<CompletionResponse>;
};

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

export type ToolExecutor = {
  execute: (toolCall: ToolCall) => Promise<ToolResult>;
};

export type OrchestrationConfig = {
  messages: Message[];
  tools?: ToolDefinition[];
  maxIterations?: number;
  sessionId?: string;
};

export type OrchestrationResult = {
  messages: Message[];
  finishReason:
    | "stop"
    | "length"
    | "content-filter"
    | "max-iterations"
    | "error";
  finalContent: string;
  iterations: number;
  error?: string;
};
