import type { RequestMetric } from "../request-metric"
import { computeDerivedMetrics } from "../derived-metrics"

export function spikeScore(metrics: RequestMetric[]): number {
  const d = computeDerivedMetrics(metrics)
  return (1 - d.spikeRate) * 100
}
