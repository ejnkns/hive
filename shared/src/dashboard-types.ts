/** @public — WebSocket protocol contract for the dashboard. Import from here, not from server or UI internals. */

import type { LogEntry } from "./logger.ts";
import type { ModelPriority } from "./model-priority-types.ts";

export type { ModelPriority };

// ---------------------------------------------------------------------------
// Leaf types
// ---------------------------------------------------------------------------

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

export type SubScores = {
  latency: number;
  throughput: number;
  reliability: number;
  quality: number;
  contextWindow: number;
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

export function isSessionStage(value: string): value is SessionStage {
  return [
    "received",
    "selection",
    "dispatched",
    "thinking",
    "streaming",
    "tool_use",
    "complete",
    "failed",
  ].includes(value);
}

export function isTerminal(stage: SessionStage): boolean {
  return stage === "complete" || stage === "failed";
}

export type FinishReason = "stop" | "length" | "content-filter" | null;

export type ErrorType =
  | "rate-limited"
  | "server-error"
  | "auth-error"
  | "timeout"
  | "network-error"
  | "invalid-request"
  | null;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type ProviderPayload = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  subscores: SubScores;
  p95Latency: number;
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

export type AvailableProvider = {
  name: string;
  displayName: string;
  models: string[];
  keyConfigured: boolean;
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

export type OverrideState = {
  active: boolean;
  provider: string | null;
  model: string | null;
};

export type StatsData = {
  traffic: number;
  successRate: number | null;
  activeProviders: number;
  avgLatency: number | null;
  bestProvider: string | null;
  bestModel: string | null;
  bestScore: number | null;
};

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

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

export type SessionState = {
  sessionId: string;
  fingerprint?: string;
  lastActivity: number;
  requests: RequestState[];
};

/**
 * Full session state snapshot — server pre-sorted into active and completed
 * lists. The consumer renders directly with zero client-side filtering.
 */
export type SessionSnapshot = {
  active: SessionState[];
  completed: SessionState[];
};

// ---------------------------------------------------------------------------
// Protocol messages — Server → Client
// ---------------------------------------------------------------------------

/**
 * The union of every message the server may send over the dashboard WebSocket.
 * The consumer switches on `type` and applies each message directly (replace
 * local state, never patch-incrementally).
 */
export type WsServerMessage =
  | InitMessage
  | SessionSnapshotMessage
  | PipelineStateMessage
  | ProviderUpdateMessage
  | MetricsUpdateMessage
  | StatsUpdateMessage
  | OverrideUpdateMessage
  | AvailableProvidersUpdateMessage
  | ModelPriorityUpdateMessage
  | LogMessage;

/**
 * Consolidated protocol: sent once on WebSocket connect. Contains the
 * full current state snapshot. After init, consumers receive individual
 * update messages for each changed concern.
 */
export type InitMessage = {
  type: "init";
  providers: ProviderPayload[];
  availableProviders: AvailableProvider[];
  metrics: MetricData[];
  override: OverrideState;
  sessions: SessionSnapshot;
  logs: LogEntry[];
  serverHost: string;
  serverPort: string;
  routingStrategy: string;
  contextWindowWeight: number;
  pending: number;
  stats: StatsData;
  modelPriorityConfig: ModelPriority | null;
};

/**
 * Sent on every session state change (new request, stage advancement, request
 * completion, failover). Contains the complete session tree so the consumer
 * does `sessions = msg.sessions` with zero patch-application logic.
 */
export type SessionSnapshotMessage = {
  type: "session_snapshot";
  sessions: SessionSnapshot;
};

/**
 * Sent on each proxy pipeline phase change (received, selection, dispatched,
 * thinking, streaming, complete, failed). Designed for the pipeline
 * visualization — each event carries its own provider and model context so
 * the consumer renders without cross-event state tracking.
 */
export type PipelineStateMessage = {
  type: "pipeline_state";
  requestId: string;
  sessionId: string;
  stage: SessionStage;
  provider: string | null;
  model: string | null;
  timestamp: number;
};

/**
 * Sent when provider scoring changes (request completion updates stability
 * scores, latency, throughput, etc.). Carries the full sorted provider list
 * so the consumer replaces its local array directly.
 */
export type ProviderUpdateMessage = {
  type: "provider_update";
  providers: ProviderPayload[];
};

/**
 * Sent when a new request completes. Carries the complete metrics array. The
 * consumer replaces its local metrics array directly. Conversation content is
 * not pushed here — it lives on the session tree (session_snapshot).
 */
export type MetricsUpdateMessage = {
  type: "metrics_update";
  metrics: MetricData[];
};

/**
 * Sent when derived dashboard statistics change. Stats are computed by the
 * server from provider and metrics data. The consumer renders the values
 * with zero derivation logic.
 */
export type StatsUpdateMessage = {
  type: "stats_update";
  stats: StatsData;
};

/**
 * Sent when the active provider:model override is set or cleared.
 */
export type OverrideUpdateMessage = {
  type: "override_update";
  override: OverrideState;
};

/**
 * Sent when the list of available providers changes (provider
 * enabled/disabled, or future runtime provider registration).
 */
export type AvailableProvidersUpdateMessage = {
  type: "available_providers_update";
  availableProviders: AvailableProvider[];
};

/**
 * Sent for each new server log entry.
 */
export type LogMessage = {
  type: "log";
  data: LogEntry;
};

/**
 * Sent when the model priority configuration changes.
 */
export type ModelPriorityUpdateMessage = {
  type: "model_priority_update";
  config: ModelPriority | null;
};

// ---------------------------------------------------------------------------
// Protocol messages — Client → Server
// ---------------------------------------------------------------------------

/**
 * Set or clear the active provider:model override (pin).
 * `enabled: true` pins the specified provider and model.
 * `enabled: false` clears the override (only sent when a pin is active).
 */
export type OverrideCommand = {
  type: "override";
  provider: string;
  model: string;
  enabled: boolean;
};

/**
 * Enable or disable a provider by name. Disabling a provider removes it
 * from routing consideration. If the disabled provider is currently pinned,
 * the pin is cleared server-side.
 */
export type ToggleProviderCommand = {
  type: "toggle_provider";
  provider: string;
  disabled: boolean;
};

export type UpdateModelPriorityCommand = {
  type: "update_model_priority";
  config: ModelPriority;
};

/** All messages the client may send over the dashboard WebSocket. */
export type WsClientMessage =
  | OverrideCommand
  | ToggleProviderCommand
  | UpdateModelPriorityCommand;
