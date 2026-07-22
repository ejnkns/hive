import type { ErrorType, FinishReason } from "telemetry";

export type SubScores = {
  latency: number;
  throughput: number;
  reliability: number;
  quality: number;
  contextWindow: number;
};

export type ProviderData = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  subscores: SubScores;
  p95Latency: number | null;
  meanTokensPerSecond: number | null;
  requestCount: number;
  recentSuccessRate: number;
  truncationRate: number;
  refusalRate: number;
  contentFilterRate: number;
  trippedUntil: number | null;
  disabledFeatures: string[] | null;
  disabled: boolean;
};

export type MetricData = {
  requestId: string;
  provider: string;
  model: string;
  timestamp: number;
  ttft: number;
  totalLatency: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTime: number | null;
  finishReason: FinishReason;
  refused: boolean;
  toolCallFailed: boolean;
  statusCode: number;
  errorType: ErrorType;
  errorBody?: string;
  success: boolean;
  source: string;
};

type ContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

type ToolCall = {
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

export type ConversationData = {
  requestId: string;
  provider: string;
  model: string;
  timestamp: number;
  ttft: number | null;
  totalLatency: number | null;
  statusCode: number;
  success: boolean;
  prompt: ConversationMessage[];
  responseText: string;
  outputTokens: number | null;
  finishReason: FinishReason;
  refused: boolean;
};

export type AvailableProvider = {
  name: string;
  displayName: string;
  models: string[];
  keyConfigured: boolean;
  disabled: boolean;
};

export type OverrideState = {
  active: boolean;
  provider: string | null;
  model: string | null;
};

export type StatsData = {
  traffic: number;
  successRate: number | null;
  providers: number;
  avgLatency: number | null;
};

export type HeaderData = {
  online: boolean;
  serverAddr: string;
  lastProvider: string | null;
  lastModel: string | null;
  override: OverrideState;
  availableProviders: AvailableProvider[];
  bestProvider: string | null;
  bestModel: string | null;
  bestScore: number | null;
  routingStrategy: string;
  contextWindowWeight: number;
  traffic: number;
  successRate: number | null;
  activeProviders: number;
  avgLatency: number | null;
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
  overrideError?: {
    provider: string;
    model: string;
    statusCode: number;
    errorType: string;
    errorBody: string;
  };
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
  overrideError?: RequestState["overrideError"];
  conversationPrompt?: ConversationMessage[];
  responseText?: string;
  response?: RequestState["response"];
};

export type FlowEvent =
  | {
      type: "request_received";
      requestId: string;
      sessionId: string;
      timestamp: number;
      promptPreview: string;
      toolLoopDetected?: boolean;
    }
  | {
      type: "selection_round";
      requestId: string;
      strategy: string;
      candidates: CandidateInfo[];
      selected: string | null;
      poolSize: number;
    }
  | {
      type: "node_dispatched";
      requestId: string;
      provider: string;
      model: string;
      attempt: number;
    }
  | {
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
    }
  | {
      type: "failover_attempt";
      requestId: string;
      failedProvider: string;
      failedModel: string;
      errorType: string;
      attempt: number;
    }
  | {
      type: "thinking_started";
      requestId: string;
      provider: string;
      model: string;
    }
  | {
      type: "streaming_started";
      requestId: string;
      provider: string;
      model: string;
    }
  | {
      type: "token_tick";
      requestId: string;
      provider: string;
      model: string;
      outputChars: number;
      thinkingChars: number;
      tokensPerSecond: number;
    }
  | {
      type: "tool_accumulating";
      requestId: string;
      provider: string;
      model: string;
      toolIndex: number;
    }
  | {
      type: "circuit_break";
      requestId: string;
      provider: string;
      model: string;
      cooldownDurationSec: number;
    }
  | {
      type: "override_failed";
      requestId: string;
      provider: string;
      model: string;
      statusCode: number;
      errorType: string;
      errorBody: string;
    };
