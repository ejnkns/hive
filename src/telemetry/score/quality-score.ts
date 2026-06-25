import type { DerivedMetrics } from "../derived-metrics";

export function qualityScore(d: DerivedMetrics): number {
  return (1 - d.truncationRate - d.refusalRate) * 100;
}
