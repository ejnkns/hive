export type RequestMetrics = {
  provider: string
  model: string
  ttft: number
  statusCode: number
  success: boolean
  timestamp: number
}

const WINDOW_SIZE = 20

export function slidingWindow(metrics: RequestMetrics[]): RequestMetrics[] {
  return metrics.slice(-WINDOW_SIZE)
}
