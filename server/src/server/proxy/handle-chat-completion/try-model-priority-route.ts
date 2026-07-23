import { logger } from "shared/logger";
import type { Node, RequestMetric } from "telemetry";
import type { ChatCompletionResult } from "../handle-chat-completion";
import { isProviderRequestCancelledError } from "../provider-request-cancelled-error";
import type { ProxyResponse } from "../proxy-response";
import { routingMemory } from "../routing-memory";
import {
  recordCircuitBreak,
  recordFailoverAttempt,
} from "../session-aggregator";
import { selectBestNode } from "./execute-proxy-request/select-best-node";

type DispatchFn = (node: Node, payload: string) => Promise<ProxyResponse>;

export async function tryModelPriorityRoute(params: {
  modelPriority: string[];
  providerPriority: string[] | undefined;
  nodes: Node[];
  dispatch: DispatchFn;
  payloadStr: string;
  requestId: string;
  getMetricsForNode: (compoundKey: string) => RequestMetric[];
  sessionId?: string;
  onSuccess?: (provider: string, model: string) => void;
}): Promise<ChatCompletionResult | null> {
  const {
    modelPriority,
    providerPriority,
    nodes,
    dispatch,
    payloadStr,
    requestId,
    getMetricsForNode,
    sessionId,
    onSuccess,
  } = params;

  for (const modelName of modelPriority) {
    const modelNodes = nodes.filter((n) => n.modelName === modelName);
    if (modelNodes.length === 0) {
      logger.debug(
        `request ${requestId} — model priority "${modelName}" not found on any qualified provider, skipping`
      );
      continue;
    }

    if (providerPriority && providerPriority.length > 0) {
      for (const providerName of providerPriority) {
        const node = modelNodes.find((n) => n.providerName === providerName);
        if (!node) continue;

        const compoundKey = `${providerName}:${modelName}`;
        if (routingMemory.isCircuitBroken(compoundKey)) {
          logger.debug(
            `request ${requestId} — model priority node ${compoundKey} circuit-broken, skipping`
          );
          continue;
        }

        const result = await tryDispatchNode({
          node,
          dispatch,
          payloadStr,
          requestId,
        });
        if (result) {
          onSuccess?.(providerName, modelName);
          return result;
        }
      }
    } else {
      const bestNode = selectBestNode(
        modelNodes,
        getMetricsForNode,
        [],
        sessionId
      );
      if (!bestNode) {
        logger.debug(
          `request ${requestId} — no eligible nodes for model priority "${modelName}"`
        );
        continue;
      }

      const compoundKey = `${bestNode.providerName}:${bestNode.modelName}`;
      if (routingMemory.isCircuitBroken(compoundKey)) {
        logger.debug(
          `request ${requestId} — selected model priority node ${compoundKey} circuit-broken`
        );
        continue;
      }

      const result = await tryDispatchNode({
        node: bestNode,
        dispatch,
        payloadStr,
        requestId,
      });
      if (result) {
        onSuccess?.(bestNode.providerName, bestNode.modelName);
        return result;
      }
    }
  }

  return null;
}

async function tryDispatchNode(params: {
  node: Node;
  dispatch: DispatchFn;
  payloadStr: string;
  requestId: string;
}): Promise<ChatCompletionResult | null> {
  const { node, dispatch, payloadStr, requestId } = params;
  const compoundKey = `${node.providerName}:${node.modelName}`;

  logger.debug(
    `request ${requestId} — trying model priority node ${node.providerName}:${node.modelName}`
  );

  try {
    const response = await dispatch(node, payloadStr);
    if (response.isOk()) {
      logger.debug(
        `request ${requestId} — model priority success via ${node.providerName}:${node.modelName}`
      );
      return {
        success: true,
        stream: response.getStream(),
        provider: node.providerName,
        model: node.modelName,
        statusCode: response.status,
      };
    }

    const normalized = await response.getNormalizedError();
    routingMemory.recordUpstreamError(compoundKey, normalized.type, []);

    recordCircuitBreak({
      requestId,
      provider: node.providerName,
      model: node.modelName,
      cooldownDurationSec: 30,
    });

    recordFailoverAttempt({
      requestId,
      failedProvider: node.providerName,
      failedModel: node.modelName,
      errorType: normalized.type,
      attempt: 1,
    });

    const errorBody = await response.getBodyAsString();
    logger.debug(
      `request ${requestId} — model priority node ${compoundKey} returned ${String(response.status)}, continuing cascade`
    );
    logger.debug(
      `request ${requestId} — model priority error body: ${errorBody.slice(0, 1000)}`
    );
  } catch (err: unknown) {
    if (isProviderRequestCancelledError(err)) {
      return { success: false, statusCode: 499, error: err.message };
    }
    routingMemory.recordNetworkFailure(compoundKey);

    recordCircuitBreak({
      requestId,
      provider: node.providerName,
      model: node.modelName,
      cooldownDurationSec: 30,
    });

    recordFailoverAttempt({
      requestId,
      failedProvider: node.providerName,
      failedModel: node.modelName,
      errorType: "network-error",
      attempt: 1,
    });

    logger.debug(
      `request ${requestId} — model priority node threw: ${err instanceof Error ? err.message : String(err)}, continuing cascade`
    );
  }

  return null;
}
