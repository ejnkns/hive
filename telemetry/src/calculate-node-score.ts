import { checkAuthGuard } from "./calculate-node-score/check-auth-guard";
import { computeContextWindowScore } from "./calculate-node-score/compute-context-window-score";
import { computeLatencyScore } from "./calculate-node-score/compute-latency-score";
import { computeQualityScore } from "./calculate-node-score/compute-quality-score";
import { computeReliabilityScore } from "./calculate-node-score/compute-reliability-score";
import { computeThroughputScore } from "./calculate-node-score/compute-throughput-score";
import { isReasoningModel } from "./calculate-node-score/shared/is-reasoning-model";
import type { RequestMetric } from "./request-metric";

export type { RequestMetric };
export type RoutingStrategy = "balanced" | "latency" | "quality";

export type SubScores = {
  latency: number;
  throughput: number;
  reliability: number;
  quality: number;
  contextWindow: number;
};

export type NodeScoreResult = {
  composite: number;
  subscores: SubScores;
};

export type Node = {
  providerName: string;
  modelName: string;
  maxContextTokens?: number;
};

type ScoreWeights = {
  ttft: number;
  throughput: number;
  reliability: number;
  quality: number;
  contextWindow: number;
};

const ROUTING_STRATEGIES: Record<RoutingStrategy, ScoreWeights> = {
  balanced: {
    ttft: 0.3,
    throughput: 0.3,
    reliability: 0.4,
    quality: 0.0,
    contextWindow: 0.0,
  },
  latency: {
    ttft: 0.55,
    throughput: 0.15,
    reliability: 0.3,
    quality: 0.0,
    contextWindow: 0.0,
  },
  quality: {
    ttft: 0.1,
    throughput: 0.1,
    reliability: 0.4,
    quality: 0.4,
    contextWindow: 0.0,
  },
};

const ZERO_SUBSCORES: SubScores = {
  latency: 0,
  throughput: 0,
  reliability: 0,
  quality: 0,
  contextWindow: 0,
};

const CONTEXT_WINDOW_WEIGHT_DEFAULT = 0;

function getContextWindowWeight(): number {
  const raw = process.env.HIVE_CONTEXT_WINDOW_WEIGHT;
  if (raw === undefined) return CONTEXT_WINDOW_WEIGHT_DEFAULT;
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1, parsed))
    : CONTEXT_WINDOW_WEIGHT_DEFAULT;
}

export function calculateNodeScore(
  node: Node,
  metrics: RequestMetric[],
  strategyName: RoutingStrategy = "balanced",
  minTokenThreshold: number = 200
): NodeScoreResult {
  const strategy =
    ROUTING_STRATEGIES[strategyName] ?? ROUTING_STRATEGIES.balanced;

  const performanceMetrics = metrics.filter(
    (m) => m.source === "user" && (m.inputTokens ?? 0) >= minTokenThreshold
  );

  const guard = checkAuthGuard(metrics);
  if (!guard.passed)
    return { composite: guard.score, subscores: ZERO_SUBSCORES };

  const reliabilityScore = computeReliabilityScore(metrics);

  if (performanceMetrics.length === 0) {
    return {
      composite:
        reliabilityScore * strategy.reliability +
        (strategy.ttft + strategy.throughput + strategy.quality) * 50,
      subscores: {
        latency: 50,
        throughput: 50,
        reliability: reliabilityScore,
        quality: 50,
        contextWindow: 0,
      },
    };
  }

  const isReasoning = isReasoningModel(node.modelName);

  const ttftScore = computeLatencyScore(performanceMetrics, isReasoning);
  const throughputScore = computeThroughputScore(
    performanceMetrics,
    isReasoning
  );
  const qualityScore = computeQualityScore(performanceMetrics);

  const cwScore = node.maxContextTokens
    ? computeContextWindowScore(node.maxContextTokens)
    : 0;

  let composite =
    ttftScore * strategy.ttft +
    throughputScore * strategy.throughput +
    reliabilityScore * strategy.reliability +
    qualityScore * strategy.quality;

  const contextWindowWeight = getContextWindowWeight();
  if (contextWindowWeight > 0 && node.maxContextTokens) {
    composite =
      composite * (1 - contextWindowWeight) + cwScore * contextWindowWeight;
  }

  return {
    composite,
    subscores: {
      latency: ttftScore,
      throughput: throughputScore,
      reliability: reliabilityScore,
      quality: qualityScore,
      contextWindow: cwScore,
    },
  };
}
