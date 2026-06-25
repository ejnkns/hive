import type { DerivedMetrics } from "../derived-metrics";

export function jitterScore(d: DerivedMetrics): number {
  return Math.max(0, 100 - d.jitterTtft / 50);
}
