import { selectBestNode } from "./node-selector";
import { routingMemory } from "./routing-memory";
import type { ProviderModelNode } from "../telemetry";
import type { RequestMetric } from "../telemetry";
import { ProxyResponse } from "./proxy-response";
import { logger } from "../hive/shared/logger";

export type FailoverContext = {
  nodes: ProviderModelNode[];
  originalPayload: string;
  requiredFeatures: string[];
  getMetricsForNode: (compoundKey: string) => RequestMetric[];
  dispatchRequest: (
    node: ProviderModelNode,
    payload: string
  ) => Promise<ProxyResponse>;
  sessionId?: string;
};

export async function executeProxyRequest(
  ctx: FailoverContext
): Promise<ProxyResponse> {
  const maxAttempts = Math.min(3, ctx.nodes.length);
  let attempts = 0;
  const tried = new Set<string>();

  while (attempts < maxAttempts) {
    const availableNodes = ctx.nodes.filter(
      (n) => !tried.has(`${n.providerName}:${n.modelName}`)
    );
    if (availableNodes.length === 0) {
      logger.debug(
        `attempt ${String(attempts)}/${String(maxAttempts)} — no untried nodes remaining`
      );
      break;
    }

    const node = selectBestNode(
      availableNodes,
      ctx.getMetricsForNode,
      ctx.requiredFeatures,
      ctx.sessionId
    );
    if (!node) {
      logger.debug(
        `attempt ${String(attempts)}/${String(maxAttempts)} — selectBestNode returned null`
      );
      break;
    }

    const compoundKey = `${node.providerName}:${node.modelName}`;
    tried.add(compoundKey);
    attempts++;

    try {
      const response = await ctx.dispatchRequest(node, ctx.originalPayload);

      if (!response.isOk()) {
        const normalized = await response.getNormalizedError();
        logger.debug(
          `attempt ${String(attempts)}/${String(maxAttempts)} — ${compoundKey} upstream error: ${normalized.type} (status ${String(response.status)})`
        );
        routingMemory.recordUpstreamError(
          compoundKey,
          normalized.type,
          ctx.requiredFeatures
        );
        continue;
      }

      logger.debug(
        `attempt ${String(attempts)}/${String(maxAttempts)} — ${compoundKey} succeeded (status ${String(response.status)})`
      );
      return response;
    } catch (err: unknown) {
      logger.debug(
        `attempt ${String(attempts)}/${String(maxAttempts)} — ${compoundKey} network failure: ${err instanceof Error ? err.message : String(err)}`
      );
      routingMemory.recordNetworkFailure(compoundKey);
      continue;
    }
  }

  throw new Error(
    "Hive Router Error: All qualifying upstream endpoints failed execution."
  );
}
