export type ProviderData = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  p95Latency: number | null;
  meanTokensPerSecond: number | null;
  requestCount: number;
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
  finishReason: string | null;
  refused: boolean;
  statusCode: number;
  errorType: string | null;
  success: boolean;
  source: string;
};

export type ContentPart = {
  type: string;
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
  finishReason: string | null;
  refused: boolean;
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
};
