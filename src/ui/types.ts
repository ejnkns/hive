import type { ErrorType, FinishReason, MetricSource } from "../telemetry";

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
  source: MetricSource;
};

export type ContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
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
  prompt: { role: string; content: string | ContentPart[] }[];
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
};

export type OverrideState = {
  active: boolean;
  provider: string | null;
  model: string | null;
};

export type StatsData = {
  traffic: number;
  successRate: number;
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
};
