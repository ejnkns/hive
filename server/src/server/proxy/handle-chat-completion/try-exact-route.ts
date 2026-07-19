import { logger } from "shared/logger";
import type { Node } from "telemetry";
import type { ChatCompletionResult } from "../handle-chat-completion";
import { isProviderRequestCancelledError } from "../provider-request-cancelled-error";
import type { ProxyResponse } from "../proxy-response";

export async function tryExactRoute(params: {
  exactNode: Node | null;
  dispatch: (node: Node, payload: string) => Promise<ProxyResponse>;
  payloadStr: string;
  requestId: string;
  onSuccess?: (provider: string, model: string) => void;
}): Promise<ChatCompletionResult | null> {
  const { exactNode, dispatch, payloadStr, requestId, onSuccess } = params;
  if (!exactNode) return null;

  logger.debug(
    `request ${requestId} — testing exact route ${exactNode.providerName}:${exactNode.modelName}`
  );

  try {
    const response = await dispatch(exactNode, payloadStr);
    if (response.isOk()) {
      onSuccess?.(exactNode.providerName, exactNode.modelName);
      return {
        success: true,
        stream: response.getStream(),
        provider: exactNode.providerName,
        model: exactNode.modelName,
        statusCode: response.status,
      };
    }

    const errorBody = await response.getBodyAsString();
    return {
      success: false,
      provider: exactNode.providerName,
      model: exactNode.modelName,
      statusCode: response.status,
      error:
        errorBody || `Exact route returned HTTP ${String(response.status)}`,
    };
  } catch (error) {
    if (isProviderRequestCancelledError(error)) {
      return { success: false, statusCode: 499, error: error.message };
    }
    return {
      success: false,
      provider: exactNode.providerName,
      model: exactNode.modelName,
      statusCode: 502,
      error:
        error instanceof Error ? error.message : "Exact route request failed",
    };
  }
}
