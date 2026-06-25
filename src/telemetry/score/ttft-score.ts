import type { DerivedMetrics } from "../derived-metrics";

export function ttftScore(d: DerivedMetrics): number {
  return Math.max(0, 100 - d.p95Ttft / 50);
}
