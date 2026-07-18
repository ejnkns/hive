import type { PassThrough } from "node:stream";
import { logger } from "shared/logger";
import type { Node } from "telemetry";
import { emitFlowEvent } from "../flow-events";
import type { ChatCompletionResult } from "../handle-chat-completion";
import type { ProxyResponse } from "../proxy-response";
import { routingMemory } from "../routing-memory";

export async function tryOverrideRoute(params: {
  overrideNode: { providerName: string; modelName: string } | null;
  dispatch: (node: Node, payload: string) => Promise<ProxyResponse>;
  payloadStr: string;
  requestId: string;
  onSuccess?: (provider: string, model: string) => void;
}): Promise<ChatCompletionResult | null> {
  const { overrideNode, dispatch, payloadStr, requestId, onSuccess } = params;
  if (!overrideNode) return null;

  logger.debug(
    `request ${requestId} — trying override node ${overrideNode.providerName}:${overrideNode.modelName}`
  );

  try {
    const response = await dispatch(overrideNode, payloadStr);
    if (response.isOk()) {
      onSuccess?.(overrideNode.providerName, overrideNode.modelName);
      logger.debug(
        `request ${requestId} — override success via ${overrideNode.providerName}:${overrideNode.modelName}`
      );
      return {
        success: true,
        stream: response.getStream() as PassThrough,
        provider: overrideNode.providerName,
        model: overrideNode.modelName,
        statusCode: response.status,
      };
    }

    const normalized = await response.getNormalizedError();
    const compoundKey = `${overrideNode.providerName}:${overrideNode.modelName}`;
    routingMemory.recordUpstreamError(compoundKey, normalized.type, []);

    emitFlowEvent({
      type: "circuit_break",
      requestId,
      provider: overrideNode.providerName,
      model: overrideNode.modelName,
      cooldownDurationSec: 30,
    });

    emitFlowEvent({
      type: "failover_attempt",
      requestId,
      failedProvider: overrideNode.providerName,
      failedModel: overrideNode.modelName,
      errorType: normalized.type,
      attempt: 1,
    });

    logger.debug(
      `request ${requestId} — override node failed (status ${String(response.status)}), falling back to auto-routing`
    );
  } catch (err: unknown) {
    const compoundKey = `${overrideNode.providerName}:${overrideNode.modelName}`;
    routingMemory.recordNetworkFailure(compoundKey);

    emitFlowEvent({
      type: "circuit_break",
      requestId,
      provider: overrideNode.providerName,
      model: overrideNode.modelName,
      cooldownDurationSec: 30,
    });

    emitFlowEvent({
      type: "failover_attempt",
      requestId,
      failedProvider: overrideNode.providerName,
      failedModel: overrideNode.modelName,
      errorType: "network-error",
      attempt: 1,
    });

    logger.debug(
      `request ${requestId} — override node threw: ${err instanceof Error ? err.message : String(err)}, falling back to auto-routing`
    );
  }

  return null;
}
