import type { RequestMetric } from "../request-metric";

export function computeQualityScore(
  performanceMetrics: RequestMetric[]
): number {
  const functionalFaults = performanceMetrics.filter(
    (m) => m.refused || m.finishReason === "length"
  ).length;

  return Math.max(
    0,
    100 - (functionalFaults / performanceMetrics.length) * 100
  );
}
