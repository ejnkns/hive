import type { Message } from "../shared/message";
import type { ToolExecutionContext, ToolRegistry } from "../tools/tool";

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

export type OrchestrationConfig = {
  messages: Message[];
  toolRegistry: ToolRegistry;
  toolContext: ToolExecutionContext;
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
