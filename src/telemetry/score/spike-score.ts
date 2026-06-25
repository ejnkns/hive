import type { DerivedMetrics } from "../derived-metrics";

export function spikeScore(d: DerivedMetrics): number {
  return (1 - d.spikeRate) * 100;
}
