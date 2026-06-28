import type { RequestMetric } from "../request-metric";
import { percentile } from "../stats";

const TTFT_HALF_LIFE_STANDARD = 1500;
const TTFT_HALF_LIFE_REASONING = 8000;

export function computeLatencyScore(
  performanceMetrics: RequestMetric[],
  isReasoning: boolean
): number {
  const validTtfts = performanceMetrics
    .map((m) => m.ttft)
    .sort((a, b) => a - b);
  const p95Ttft = percentile(validTtfts, 0.95) || 500;

  const ttftHalfLife = isReasoning
    ? TTFT_HALF_LIFE_REASONING
    : TTFT_HALF_LIFE_STANDARD;
  return Math.exp(-p95Ttft / ttftHalfLife) * 100;
}
