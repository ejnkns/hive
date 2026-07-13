export type ContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

export type ToolCall = {
  id: string;
  type: string;
  function: { name: string; arguments: string };
};

export type ConversationMessage = {
  role: string;
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type CandidateInfo = {
  key: string;
  provider: string;
  model: string;
  score: number;
  status: "eligible" | "circuit-broken" | "feature-mismatch";
  affinity: boolean;
  cooldownSec?: number;
};

export type RequestReceivedEvent = {
  type: "request_received";
  requestId: string;
  sessionId: string;
  timestamp: number;
  promptPreview: string;
  toolLoopDetected?: boolean;
};

export type SelectionRoundEvent = {
  type: "selection_round";
  requestId: string;
  strategy: string;
  candidates: CandidateInfo[];
  selected: string | null;
  poolSize: number;
};

export type NodeDispatchedEvent = {
  type: "node_dispatched";
  requestId: string;
  provider: string;
  model: string;
  attempt: number;
};

export type ResponseCompleteEvent = {
  type: "response_complete";
  requestId: string;
  provider: string;
  model: string;
  statusCode: number;
  success: boolean;
  ttft: number;
  totalLatency: number;
  outputTokens: number | null;
  finishReason: string | null;
  toolCallFailed: boolean;
  errorType: string | null;
};

export type FailoverAttemptEvent = {
  type: "failover_attempt";
  requestId: string;
  failedProvider: string;
  failedModel: string;
  errorType: string;
  attempt: number;
};

export type ThinkingStartedEvent = {
  type: "thinking_started";
  requestId: string;
  provider: string;
  model: string;
};

export type StreamingStartedEvent = {
  type: "streaming_started";
  requestId: string;
  provider: string;
  model: string;
};

export type TokenTickEvent = {
  type: "token_tick";
  requestId: string;
  provider: string;
  model: string;
  outputChars: number;
  thinkingChars: number;
  tokensPerSecond: number;
};

export type ToolAccumulatingEvent = {
  type: "tool_accumulating";
  requestId: string;
  provider: string;
  model: string;
  toolIndex: number;
};

export type CircuitBreakEvent = {
  type: "circuit_break";
  requestId: string;
  provider: string;
  model: string;
  cooldownDurationSec: number;
};

export type SessionStage =
  | "received"
  | "selection"
  | "dispatched"
  | "thinking"
  | "streaming"
  | "tool_use"
  | "complete"
  | "failed";

export type SessionState = {
  sessionId: string;
  fingerprint?: string;
  lastActivity: number;
  requests: RequestState[];
};

export type RequestState = {
  requestId: string;
  path: SessionStage[];
  timestamp: number;
  prompt?: string;
  provider?: string;
  model?: string;
  candidates?: CandidateInfo[];
  selected?: string;
  strategy?: string;
  poolSize?: number;
  outputChars?: number;
  thinkingChars?: number;
  tokensPerSecond?: number;
  failovers: { provider: string; model: string; errorType: string }[];
  toolLoopDetected?: boolean;
  conversationPrompt?: ConversationMessage[];
  responseText?: string;
  response?: {
    provider: string;
    model: string;
    statusCode: number;
    success: boolean;
    ttft: number;
    totalLatency: number;
    outputTokens: number | null;
    finishReason: string | null;
    toolCallFailed: boolean;
    errorType: string | null;
  };
};

export type SessionPatch = {
  sessionId: string;
  initial?: { fingerprint?: string; timestamp: number };
  lastActivity?: number;
  requestId?: string;
  requestInitial?: { timestamp: number; prompt?: string };
  path?: SessionStage[];
  toolLoopDetected?: boolean;
  provider?: string;
  model?: string;
  candidates?: CandidateInfo[];
  selected?: string;
  strategy?: string;
  poolSize?: number;
  outputChars?: number;
  thinkingChars?: number;
  tokensPerSecond?: number;
  failover?: { provider: string; model: string; errorType: string };
  conversationPrompt?: ConversationMessage[];
  responseText?: string;
  response?: RequestState["response"];
};

export type FlowEvent =
  | RequestReceivedEvent
  | SelectionRoundEvent
  | NodeDispatchedEvent
  | ResponseCompleteEvent
  | FailoverAttemptEvent
  | ThinkingStartedEvent
  | StreamingStartedEvent
  | TokenTickEvent
  | ToolAccumulatingEvent
  | CircuitBreakEvent;

type FlowEventListener = (event: FlowEvent) => void;

const listeners = new Set<FlowEventListener>();

export function onFlowEvent(listener: FlowEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitFlowEvent(event: FlowEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // ignore listener errors
    }
  }
}
