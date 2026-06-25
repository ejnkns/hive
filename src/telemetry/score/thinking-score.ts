import type { DerivedMetrics } from "../derived-metrics";

export function thinkingScore(d: DerivedMetrics): number {
  if (d.meanThinkingTime === null) return 0;
  return Math.max(0, 100 - d.meanThinkingTime / 600);
}
