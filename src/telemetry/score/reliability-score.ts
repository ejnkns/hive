import type { DerivedMetrics } from "../derived-metrics";

export function reliabilityScore(d: DerivedMetrics): number {
  return (1 - d.weightedErrorRate) * 100;
}
