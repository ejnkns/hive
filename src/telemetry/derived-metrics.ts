import type { RequestMetric } from "./request-metric"

export type DerivedMetrics = {
  requestCount: number

  p95Ttft: number
  p99Ttft: number
  meanTtft: number
  jitterTtft: number

  meanTokensPerSecond: number
  p50TokensPerSecond: number

  successRate: number
  errorRateByType: Record<string, number>

  meanThinkingTime: number | null

  truncationRate: number
  refusalRate: number

  spikeRate: number
}

function sortedLatencies(metrics: RequestMetric[]): number[] {
  return metrics.map((m) => m.ttft).sort((a, b) => a - b)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function computeDerivedMetrics(metrics: RequestMetric[]): DerivedMetrics {
  const n = metrics.length

  const latencies = sortedLatencies(metrics)

  const ttftValues = metrics.map((m) => m.ttft)
  const meanTtft = mean(ttftValues)
  const variance = mean(ttftValues.map((v) => (v - meanTtft) ** 2))
  const jitterTtft = Math.sqrt(variance)

  const throughputs = metrics
    .filter((m) => m.outputTokens !== null && m.totalLatency > m.ttft)
    .map((m) => {
      const secs = (m.totalLatency - m.ttft) / 1000
      return (m.outputTokens as number) / secs
    })
    .sort((a, b) => a - b)

  const thinkingTimes = metrics
    .filter((m) => m.thinkingTime !== null)
    .map((m) => m.thinkingTime as number)

  const successful = metrics.filter((m) => m.success).length

  const errorRateByType: Record<string, number> = {}
  for (const m of metrics) {
    if (m.errorType) {
      errorRateByType[m.errorType] = (errorRateByType[m.errorType] ?? 0) + 1
    }
  }
  for (const key of Object.keys(errorRateByType)) {
    errorRateByType[key] /= n
  }

  const truncated = metrics.filter((m) => m.finishReason === "length").length
  const refused = metrics.filter((m) => m.refused).length

  const meanTtftVal = meanTtft
  const dynamicThreshold = meanTtftVal * 3
  const spikes = metrics.filter((m) => m.ttft > dynamicThreshold).length

  return {
    requestCount: n,
    p95Ttft: percentile(latencies, 0.95),
    p99Ttft: percentile(latencies, 0.99),
    meanTtft: meanTtftVal,
    jitterTtft,
    meanTokensPerSecond: mean(throughputs),
    p50TokensPerSecond: percentile(throughputs, 0.5),
    successRate: n > 0 ? successful / n : 0,
    errorRateByType,
    meanThinkingTime: thinkingTimes.length > 0 ? mean(thinkingTimes) : null,
    truncationRate: n > 0 ? truncated / n : 0,
    refusalRate: n > 0 ? refused / n : 0,
    spikeRate: n > 0 ? spikes / n : 0,
  }
}
