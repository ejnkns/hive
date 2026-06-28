import type { RequestMetric } from "./request-metric";
import { checkAuthGuard } from "./calculate-node-score/check-auth-guard";
import { computeReliabilityScore } from "./calculate-node-score/compute-reliability-score";
import { computeLatencyScore } from "./calculate-node-score/compute-latency-score";
import { computeThroughputScore } from "./calculate-node-score/compute-throughput-score";
import { computeQualityScore } from "./calculate-node-score/compute-quality-score";
import { isReasoningModel } from "./calculate-node-score/shared/is-reasoning-model";

export type { RequestMetric };

export type Node = {
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

export function calculateNodeScore(
  node: Node,
  metrics: RequestMetric[],
  strategyName: string = "balanced",
  minTokenThreshold: number = 200
): number {
  const strategy =
    ROUTING_STRATEGIES[strategyName] ?? ROUTING_STRATEGIES.balanced;

  const performanceMetrics = metrics.filter(
    (m) => m.source === "user" && (m.inputTokens ?? 0) >= minTokenThreshold
  );

  const guard = checkAuthGuard(metrics);
  if (!guard.passed) return guard.score;

  const reliabilityScore = computeReliabilityScore(metrics);

  if (performanceMetrics.length === 0) {
    return (
      reliabilityScore * strategy.reliability +
      (strategy.ttft + strategy.throughput + strategy.quality) * 50
    );
  }

  const isReasoning = isReasoningModel(node.modelName);

  const ttftScore = computeLatencyScore(performanceMetrics, isReasoning);
  const throughputScore = computeThroughputScore(
    performanceMetrics,
    isReasoning
  );
  const qualityScore = computeQualityScore(performanceMetrics);

  return (
    ttftScore * strategy.ttft +
    throughputScore * strategy.throughput +
    reliabilityScore * strategy.reliability +
    qualityScore * strategy.quality
  );
}
