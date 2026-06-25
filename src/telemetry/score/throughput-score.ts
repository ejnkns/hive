import type { RequestMetric } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"

export function throughputScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)
  return Math.min(100, d.meanTokensPerSecond / 2)
}
