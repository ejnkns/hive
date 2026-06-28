import type { RequestMetric } from "./request-metric";
import { ERROR_PENALTIES } from "./weights";
import { percentile } from "./stats";

export type { RequestMetric };

export type ProviderModelNode = {
  providerName: string;
  modelName: string;
};

type ScoreWeights = {
  ttft: number;
  throughput: number;
  reliability: number;
  quality: number;
};

const ROUTING_STRATEGIES: Record<string, ScoreWeights> = {
  balanced: { ttft: 0.3, throughput: 0.3, reliability: 0.4, quality: 0.0 },
  latency: { ttft: 0.55, throughput: 0.15, reliability: 0.3, quality: 0.0 },
  quality: { ttft: 0.1, throughput: 0.1, reliability: 0.4, quality: 0.4 },
};

const DECAY_HALF_LIFE_MS = 30 * 60 * 1000;

function getFailureWeight(m: RequestMetric): number {
  if (m.success) return 0;
  if (m.errorType) {
    return ERROR_PENALTIES[m.errorType] ?? 1.0;
  }
  return 1.0;
}

export function calculateNodeScore(
  node: ProviderModelNode,
  metrics: RequestMetric[],
  strategyName: string = "balanced",
  minTokenThreshold: number = 200
): number {
  const strategy =
    ROUTING_STRATEGIES[strategyName] ?? ROUTING_STRATEGIES.balanced;

  const performanceMetrics = metrics.filter(
    (m) => m.source === "user" && (m.inputTokens ?? 0) >= minTokenThreshold
  );

  const totalRequests = metrics.length;
  let previousWasAuthError = false;
  let consecutiveAuthErrors = 0;
  let totalErrors = 0;

  const chronologicalMetrics = [...metrics].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  for (const m of chronologicalMetrics) {
    if (!m.success) {
      totalErrors++;
      if (
        m.statusCode === 401 ||
        m.statusCode === 403 ||
        m.errorType === "auth-error"
      ) {
        if (previousWasAuthError) {
          consecutiveAuthErrors++;
        } else {
          previousWasAuthError = true;
          consecutiveAuthErrors = 1;
        }
      }
    } else {
      break;
    }
  }

  if (
    consecutiveAuthErrors >= 2 ||
    (totalRequests > 0 && totalErrors === totalRequests)
  ) {
    return 0;
  }

  const now = Date.now();
  let totalPenaltyPoints = 0;
  let maxPossiblePoints = 0;

  for (const m of metrics) {
    const age = now - m.timestamp;
    const decay = Math.exp(-age / DECAY_HALF_LIFE_MS);
    const severity = getFailureWeight(m);

    totalPenaltyPoints += severity * decay;
    maxPossiblePoints += Math.max(severity, 1.0) * decay;
  }

  const penaltyRate =
    maxPossiblePoints > 0 ? totalPenaltyPoints / maxPossiblePoints : 0;
  const reliabilityScore = Math.max(0, 100 - penaltyRate * 100);

  if (performanceMetrics.length === 0) {
    return (
      reliabilityScore * strategy.reliability +
      (strategy.ttft + strategy.throughput + strategy.quality) * 50
    );
  }

  const validTtfts = performanceMetrics
    .map((m) => m.ttft)
    .sort((a, b) => a - b);
  const p95Ttft = percentile(validTtfts, 0.95) || 500;

  let cumulativeTps = 0;
  let validTpsCount = 0;
  for (const m of performanceMetrics) {
    if (m.outputTokens && m.totalLatency) {
      console.log(
        "***check if ttft and totalLatency are almost equal, update varianceLimit ***",
        m.ttft,
        m.totalLatency
      );
      const varianceLimit = 0.01;
      const streamSeconds =
        Math.abs(m.ttft - m.totalLatency) < varianceLimit
          ? m.totalLatency / 1000
          : (m.totalLatency - m.ttft) / 1000;

      if (streamSeconds > 0) {
        cumulativeTps += m.outputTokens / streamSeconds;
        validTpsCount++;
      }
    }
  }
  const meanTps = validTpsCount > 0 ? cumulativeTps / validTpsCount : 30;

  const isReasoningModel = node.modelName
    .toLowerCase()
    .match(/(r1|o1|o3|thinking|reasoning)/);

  const ttftHalfLife = isReasoningModel ? 8000 : 1500;
  const ttftScore = Math.exp(-p95Ttft / ttftHalfLife) * 100;

  const targetTps = isReasoningModel ? 25 : 80;
  const throughputScore = Math.min(100, (meanTps / targetTps) * 100);

  const functionalFaults = performanceMetrics.filter(
    (m) => m.refused || m.finishReason === "length"
  ).length;
  const qualityScore = Math.max(
    0,
    100 - (functionalFaults / performanceMetrics.length) * 100
  );

  return (
    ttftScore * strategy.ttft +
    throughputScore * strategy.throughput +
    reliabilityScore * strategy.reliability +
    qualityScore * strategy.quality
  );
}
