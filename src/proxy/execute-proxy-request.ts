import { logger } from "../shared/logger";
import type { Node, RequestMetric } from "../telemetry";
import { selectBestNode } from "./execute-proxy-request/select-best-node";
import { emitFlowEvent } from "./flow-events";
import type { ProxyResponse } from "./proxy-response";
import { routingMemory } from "./routing-memory";

export type FailoverContext = {
  nodes: Node[];
  originalPayload: string;
  requiredFeatures: string[];
  getMetricsForNode: (compoundKey: string) => RequestMetric[];
  dispatchRequest: (node: Node, payload: string) => Promise<ProxyResponse>;
  sessionId?: string;
  signal?: AbortSignal;
};

export async function executeProxyRequest(
  ctx: FailoverContext
): Promise<ProxyResponse> {
  const maxAttempts = Math.min(3, ctx.nodes.length);
  let attempts = 0;
  const tried = new Set<string>();

  while (attempts < maxAttempts) {
    if (ctx.signal?.aborted) break;

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
        emitFlowEvent({
          type: "circuit_break",
          requestId: ctx.sessionId ?? "",
          provider: node.providerName,
          model: node.modelName,
          cooldownDurationSec: 30,
        });
        emitFlowEvent({
          type: "failover_attempt",
          requestId: ctx.sessionId ?? "",
          failedProvider: node.providerName,
          failedModel: node.modelName,
          errorType: normalized.type,
          attempt: attempts,
        });
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
      emitFlowEvent({
        type: "circuit_break",
        requestId: ctx.sessionId ?? "",
        provider: node.providerName,
        model: node.modelName,
        cooldownDurationSec: 30,
      });
      emitFlowEvent({
        type: "failover_attempt",
        requestId: ctx.sessionId ?? "",
        failedProvider: node.providerName,
        failedModel: node.modelName,
        errorType: "network-error",
        attempt: attempts,
      });
    }
  }

  throw new Error(
    "Hive Router Error: All qualifying upstream endpoints failed execution."
  );
}
