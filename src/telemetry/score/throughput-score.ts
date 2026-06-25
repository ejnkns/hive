import type { DerivedMetrics } from "../derived-metrics";

export function throughputScore(d: DerivedMetrics): number {
  if (d.meanTokensPerSecond === null) return 0;
  return Math.min(100, d.meanTokensPerSecond / 2);
}
