import type { RequestMetric } from "../request-metric";

const DEFAULT_MEAN_TPS = 30;
const TARGET_TPS_STANDARD = 80;
const TARGET_TPS_REASONING = 25;
const STREAMING_VARIANCE_LIMIT = 0.01;

export function computeThroughputScore(
  performanceMetrics: RequestMetric[],
  isReasoning: boolean
): number {
  let cumulativeTps = 0;
  let validTpsCount = 0;

  for (const m of performanceMetrics) {
    if (m.outputTokens && m.totalLatency) {
      const streamSeconds =
        Math.abs(m.ttft - m.totalLatency) < STREAMING_VARIANCE_LIMIT
          ? m.totalLatency / 1000
          : (m.totalLatency - m.ttft) / 1000;

      if (streamSeconds > 0) {
        cumulativeTps += m.outputTokens / streamSeconds;
        validTpsCount++;
      }
    }
  }

  const meanTps =
    validTpsCount > 0 ? cumulativeTps / validTpsCount : DEFAULT_MEAN_TPS;
  const targetTps = isReasoning ? TARGET_TPS_REASONING : TARGET_TPS_STANDARD;
  return Math.min(100, (meanTps / targetTps) * 100);
}
