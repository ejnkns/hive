import type { RequestMetric } from "../request-metric"

export function thinkingScore(metrics: RequestMetric[]): number {
  const thinkingTimes = metrics
    .filter((m) => m.thinkingTime !== null)
    .map((m) => m.thinkingTime as number)

  if (thinkingTimes.length === 0) return 0

  const mean = thinkingTimes.reduce((a, b) => a + b, 0) / thinkingTimes.length
  return Math.max(0, 100 - mean / 100)
}
