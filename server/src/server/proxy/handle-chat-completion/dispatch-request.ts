import type { IncomingHttpHeaders } from "node:http";
import { logger } from "shared/logger";
import { createTelemetrySink, type Node } from "telemetry";
import type { Provider } from "../../providers";
import { mutateRequest } from "../mutate-request";
import { ProxyResponse } from "../proxy-response";
import { routeRequest } from "../route-request";
import { sanitizePayloadForProvider } from "./dispatch-request/sanitize-payload-for-provider";

export async function dispatchRequest(
  node: Node,
  payload: string,
  qualified: ReadonlyArray<Provider>,
  headers: IncomingHttpHeaders,
  requestId: string,
  signal?: AbortSignal
): Promise<ProxyResponse> {
  const provider = qualified.find((p) => p.name === node.providerName);
  if (!provider) {
    logger.debug(
      `dispatch: provider config not found for ${node.providerName}`
    );
    return ProxyResponse.error(500, "config-error");
  }

  const sanitized = sanitizePayloadForProvider(
    JSON.parse(payload) as Record<string, unknown>
  );

  const mutated = mutateRequest({
    originalHeaders: headers,
    originalBody: JSON.stringify(sanitized),
    targetProvider: provider,
    targetModel: node.modelName,
  });

  const result = await routeRequest({
    upstreamUrl: provider.chatEndpoint,
    mutated,
    // Node's request timeout is an INACTIVITY timeout (fires after this many
    // ms with no bytes). 10s is fatal to reasoning models, which can pause for
    // tens of seconds between emitted tokens mid-thought — and flow generation
    // is the longest model call in the system. 60s keeps failures bounded
    // while tolerating long reasoning bursts.
    timeoutMs: 60000,
    providerName: node.providerName,
    modelName: node.modelName,
    requestId,
    telemetrySink: createTelemetrySink(),
    signal,
  });

  logger.debug(
    `dispatch → ${node.providerName}:${node.modelName} — status ${String(result.proxyResponse.status)}, ttft ${String(result.ttft)}ms`
  );

  return result.proxyResponse;
}
