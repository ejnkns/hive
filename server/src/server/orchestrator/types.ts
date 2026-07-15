import type { Readable } from "node:stream";
import type { Message } from "shared/message";
import type { OrchestrationEvent } from "shared/orchestration-event";
import type {
  ToolCall,
  ToolExecutionContext,
  ToolRegistry,
} from "./tools/tool";

export type CompletionRequest = {
  payload: Record<string, unknown>;
  sessionId?: string;
};

export type CompletionResponse = {
  status: number;
  ok: boolean;
  stream: Readable;
  provider: string | null;
  model: string | null;
  error?: string;
};

export type ModelCaller = {
  complete: (request: CompletionRequest) => Promise<CompletionResponse>;
};

export type ParsedModelResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
};

export type OrchestrationConfig = {
  messages: Message[];
  toolRegistry: ToolRegistry;
  toolContext: ToolExecutionContext;
  maxIterations?: number;
  sessionId?: string;
  onEvent?: (event: OrchestrationEvent) => void;
};

export type { OrchestrationEvent };

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
