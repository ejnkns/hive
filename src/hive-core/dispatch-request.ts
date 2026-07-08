import type { IncomingHttpHeaders } from "node:http";
import { buildChatEndpoint, getModelId, type Provider } from "../providers";
import { mutateRequest, ProxyResponse, routeRequest } from "../proxy";
import { logger } from "../shared/logger";
import type { Node } from "../telemetry";
import { sanitizePayloadForProvider } from "./sanitize-payload-for-provider";

export async function dispatchRequest(
  node: Node,
  payload: string,
  qualified: ReadonlyArray<Provider>,
  headers: IncomingHttpHeaders,
  requestId: string
): Promise<ProxyResponse> {
  const provider = qualified.find((p) => p.name === node.providerName);
  if (!provider) {
    logger.debug(
      `dispatch: provider config not found for ${node.providerName}`
    );
    return ProxyResponse.error(500, "config-error");
  }

  const sanitized = sanitizePayloadForProvider(
    node.providerName,
    JSON.parse(payload) as Record<string, unknown>
  );

  const mutated = mutateRequest({
    originalHeaders: headers,
    originalBody: JSON.stringify(sanitized),
    targetProvider: provider,
    targetModel: node.modelName,
  });

  const result = await routeRequest({
    upstreamUrl: buildChatEndpoint(provider.baseUrl),
    mutated,
    timeoutMs: 10000,
    providerName: node.providerName,
    modelName: node.modelName,
    requestId,
  });

  logger.debug(
    `dispatch → ${node.providerName}:${node.modelName} — status ${String(result.proxyResponse.status)}, ttft ${String(result.ttft)}ms`
  );

  return result.proxyResponse;
}
