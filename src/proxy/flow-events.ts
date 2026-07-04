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
  timestamp: number;
  promptPreview: string;
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
