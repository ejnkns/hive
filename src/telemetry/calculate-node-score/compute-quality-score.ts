import type { RequestMetric } from "../request-metric";

type FaultPredicate = (metric: RequestMetric) => boolean;

const FUNCTIONAL_FAULTS: FaultPredicate[] = [
  (m) => m.refused,
  (m) => m.finishReason === "length",
  (m) => m.finishReason === "content-filter",
  (m) => m.toolCallFailed,
];

export function computeQualityScore(performanceMetrics: RequestMetric[]): number {
  const functionalFaults = performanceMetrics.filter((m) => FUNCTIONAL_FAULTS.some((pred) => pred(m))).length;

  return Math.max(0, 100 - (functionalFaults / performanceMetrics.length) * 100);
}
