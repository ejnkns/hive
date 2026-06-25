import type { RequestMetric } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"

export function jitterScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)
  return Math.max(0, 100 - d.jitterTtft / 50)
}
