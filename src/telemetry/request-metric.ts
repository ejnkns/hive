type FinishReason = "stop" | "length" | "content-filter" | null

export type ErrorType =
  | "rate-limited"
  | "server-error"
  | "auth-error"
  | "timeout"
  | "network-error"
  | "invalid-request"
  | null

type MetricSource = "user" | "heartbeat"

export type RequestMetric = {
  requestId: string
  provider: string
  model: string
  timestamp: number

  ttft: number
  totalLatency: number

  inputTokens: number | null
  outputTokens: number | null

  thinkingTime: number | null

  finishReason: FinishReason
  refused: boolean

  statusCode: number
  errorType: ErrorType
  success: boolean

  source: MetricSource
}
