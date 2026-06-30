import { logger } from "../shared/logger";
import type { RequestMetric } from "../telemetry";
import { calculateNodeScore, type Node, type RoutingStrategy } from "../telemetry";
import { routingMemory } from "./routing-memory";

export function selectBestNode(
  nodes: Node[],
  getMetricsForNode: (compoundKey: string) => RequestMetric[],
  requiredFeatures: string[] = [],
  sessionId?: string
): Node | null {
  const config = getHiveConfig();
  const candidates: {
    node: Node;
    score: number;
    compoundKey: string;
  }[] = [];

  for (const node of nodes) {
    const compoundKey = `${node.providerName}:${node.modelName}`;

    if (!routingMemory.isNodeEligible(compoundKey, requiredFeatures)) {
      logger.debug(`node ${compoundKey} — ineligible (circuit breaker or unsupported features)`);
      continue;
    }

    const metrics = getMetricsForNode(compoundKey);
    let score = calculateNodeScore(node, metrics, config.strategy, config.minTokenThreshold).composite;

    if (sessionId && routingMemory.getNodeAffinity(sessionId) === compoundKey) {
      score *= 1.1;
      logger.debug(`node ${compoundKey} — session affinity applied (×1.1) → ${score.toFixed(1)}`);
    } else {
      logger.debug(`node ${compoundKey} — score ${score.toFixed(1)}`);
    }

    const normalizedScore = Math.max(0, score);
    candidates.push({ node, score: normalizedScore, compoundKey });
  }

  if (candidates.length === 0) {
    logger.debug(`no eligible candidates from ${String(nodes.length)} nodes`);
    return null;
  }

  const maxScore = Math.max(...candidates.map((c) => c.score));
  const poolThreshold = maxScore - 5;
  const qualifiedPool = candidates.filter((c) => c.score >= poolThreshold);

  const totalWeight = qualifiedPool.reduce((sum, c) => sum + Math.max(1, c.score - poolThreshold + 1), 0);
  let selectionRoll = Math.random() * totalWeight;

  for (const candidate of qualifiedPool) {
    const weight = Math.max(1, candidate.score - poolThreshold + 1);
    selectionRoll -= weight;
    if (selectionRoll <= 0) {
      if (sessionId) {
        routingMemory.setNodeAffinity(sessionId, candidate.compoundKey);
      }
      logger.debug(
        `selected ${candidate.compoundKey} (score ${candidate.score.toFixed(1)}, weight ${weight.toFixed(1)}, roll ${selectionRoll.toFixed(1)}/${totalWeight.toFixed(1)})`
      );
      return candidate.node;
    }
  }

  logger.debug(`fallback to top candidate ${qualifiedPool[0].compoundKey}`);
  return qualifiedPool[0].node;
}

type HiveRoutingConfig = {
  strategy: RoutingStrategy;
  minTokenThreshold: number;
};

function getHiveConfig(): HiveRoutingConfig {
  return {
    // env value expected to be one of "balanced", "latency", "quality"
    strategy: (process.env.HIVE_ROUTING_STRATEGY || "balanced") as RoutingStrategy,
    minTokenThreshold: parseInt(process.env.HIVE_MIN_TOKEN_TELEMETRY || "200", 10),
  };
}
