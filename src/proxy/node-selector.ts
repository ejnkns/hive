import { calculateNodeScore, type ProviderModelNode } from "../telemetry/score";
import type { RequestMetric } from "../telemetry/request-metric";
import { routingMemory } from "./routing-memory";

export type HiveRoutingConfig = {
  strategy: string;
  minTokenThreshold: number;
};

export function getHiveConfig(): HiveRoutingConfig {
  return {
    strategy: process.env.HIVE_ROUTING_STRATEGY || "balanced",
    minTokenThreshold: parseInt(
      process.env.HIVE_MIN_TOKEN_TELEMETRY || "200",
      10
    ),
  };
}

export function selectBestNode(
  nodes: ProviderModelNode[],
  getMetricsForNode: (compoundKey: string) => RequestMetric[],
  requiredFeatures: string[] = [],
  sessionId?: string
): ProviderModelNode | null {
  const config = getHiveConfig();
  const candidates: {
    node: ProviderModelNode;
    score: number;
    compoundKey: string;
  }[] = [];

  for (const node of nodes) {
    const compoundKey = `${node.providerName}:${node.modelName}`;

    if (!routingMemory.isNodeEligible(compoundKey, requiredFeatures)) continue;

    const metrics = getMetricsForNode(compoundKey);
    let score = calculateNodeScore(
      node,
      metrics,
      config.strategy,
      config.minTokenThreshold
    );

    if (sessionId && routingMemory.getNodeAffinity(sessionId) === compoundKey) {
      score *= 1.1;
    }

    const normalizedScore = Math.max(0, score);
    candidates.push({ node, score: normalizedScore, compoundKey });
  }

  if (candidates.length === 0) return null;

  const maxScore = Math.max(...candidates.map((c) => c.score));
  const poolThreshold = maxScore - 5;
  const qualifiedPool = candidates.filter((c) => c.score >= poolThreshold);

  const totalWeight = qualifiedPool.reduce(
    (sum, c) => sum + Math.max(1, c.score - poolThreshold + 1),
    0
  );
  let selectionRoll = Math.random() * totalWeight;

  for (const candidate of qualifiedPool) {
    const weight = Math.max(1, candidate.score - poolThreshold + 1);
    selectionRoll -= weight;
    if (selectionRoll <= 0) {
      if (sessionId) {
        routingMemory.setNodeAffinity(sessionId, candidate.compoundKey);
      }
      return candidate.node;
    }
  }

  return qualifiedPool[0].node;
}
