import { ERROR_PENALTIES } from "./error-penalties";
import type { RequestMetric } from "./request-metric";
import { mean, percentile } from "./stats";

/** @package */
export type DerivedMetrics = {
  requestCount: number;

  p95Ttft: number;
  p99Ttft: number;
  meanTtft: number;
  jitterTtft: number;

  meanTokensPerSecond: number | null;
  p50TokensPerSecond: number | null;

  successRate: number;
  errorRateByType: Record<string, number>;
  weightedErrorRate: number;

  meanThinkingTime: number | null;

  truncationRate: number;
  refusalRate: number;

  spikeRate: number;

  hasSuccessMetrics: boolean;
};

function sortedLatencies(metrics: RequestMetric[]): number[] {
  return metrics.map((m) => m.ttft).sort((a, b) => a - b);
}

/** @package */
export function computeDerivedMetrics(metrics: RequestMetric[]): DerivedMetrics {
  const n = metrics.length;

  const perfMetrics = metrics.filter((m) => m.success && m.source !== "heartbeat");
  const successMetrics = perfMetrics.length > 0 ? perfMetrics : metrics.filter((m) => m.success);
  const hasSuccessMetrics = successMetrics.length > 0;

  const latencies = sortedLatencies(successMetrics);

  const ttftValues = successMetrics.map((m) => m.ttft);
  const meanTtft = mean(ttftValues);
  const variance = mean(ttftValues.map((v) => (v - meanTtft) ** 2));
  const jitterTtft = Math.sqrt(variance);

  const throughputs = successMetrics
    .filter((m) => m.outputTokens !== null && m.totalLatency > m.ttft)
    .map((m) => {
      const secs = (m.totalLatency - m.ttft) / 1000;
      // filtered above for outputTokens !== null
      return (m.outputTokens as number) / secs;
    })
    .sort((a, b) => a - b);

  // filtered above for thinkingTime !== null
  const thinkingTimes = successMetrics.filter((m) => m.thinkingTime !== null).map((m) => m.thinkingTime as number);

  const successful = metrics.filter((m) => m.success).length;

  const errorRateByType: Record<string, number> = {};
  for (const m of metrics) {
    if (m.errorType) {
      errorRateByType[m.errorType] = (errorRateByType[m.errorType] ?? 0) + 1;
    }
  }
  for (const key of Object.keys(errorRateByType)) {
    errorRateByType[key] /= n;
  }

  let weightedErrors = 0;
  for (const m of metrics) {
    if (m.errorType) {
      weightedErrors += ERROR_PENALTIES[m.errorType] ?? 1.0;
    }
  }
  const weightedErrorRate = n > 0 ? weightedErrors / n : 0;

  const truncated = successMetrics.filter((m) => m.finishReason === "length").length;
  const refused = successMetrics.filter((m) => m.refused).length;
  const successCount = successMetrics.length;

  const successTtfts = successMetrics.map((m) => m.ttft);
  const successMean = successTtfts.length > 0 ? mean(successTtfts) : meanTtft;
  const dynamicThreshold = successMean * 3;
  const spikes = successMetrics.filter((m) => m.ttft > dynamicThreshold).length;

  return {
    requestCount: n,
    p95Ttft: percentile(latencies, 0.95),
    p99Ttft: percentile(latencies, 0.99),
    meanTtft,
    jitterTtft,
    meanTokensPerSecond: throughputs.length > 0 ? mean(throughputs) : null,
    p50TokensPerSecond: throughputs.length > 0 ? percentile(throughputs, 0.5) : null,
    successRate: n > 0 ? successful / n : 0,
    errorRateByType,
    weightedErrorRate,
    meanThinkingTime: thinkingTimes.length > 0 ? mean(thinkingTimes) : null,
    truncationRate: successCount > 0 ? truncated / successCount : 0,
    refusalRate: successCount > 0 ? refused / successCount : 0,
    spikeRate: successCount > 0 ? spikes / successCount : 0,
    hasSuccessMetrics,
  };
}
