import type { RequestMetric, ErrorType } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"
import { ERROR_PENALTIES } from "../weights"

export function reliabilityScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)

  let weightedErrors = 0
  for (const m of metrics) {
    if (m.errorType) {
      const penalty = ERROR_PENALTIES[m.errorType as keyof typeof ERROR_PENALTIES] ?? 1.0
      weightedErrors += penalty
    }
  }

  const weightedErrorRate = metrics.length > 0 ? weightedErrors / metrics.length : 0
  return (1 - weightedErrorRate) * 100
}
