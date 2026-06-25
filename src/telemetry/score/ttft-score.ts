import type { RequestMetric } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"

export function ttftScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)
  return Math.max(0, 100 - d.p95Ttft / 50)
}
