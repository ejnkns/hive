export type FinishReason = "stop" | "length" | "content-filter" | null;

export type ErrorType =
  | "rate-limited"
  | "server-error"
  | "auth-error"
  | "timeout"
  | "network-error"
  | "invalid-request"
  | null;

export type MetricSource = "user";

export type RequestMetric = {
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
