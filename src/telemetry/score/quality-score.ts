import type { RequestMetric } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"

export function qualityScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)
  return (1 - d.truncationRate - d.refusalRate) * 100
}
