/** @internal — proxy module private implementation */

import type { IncomingHttpHeaders } from "node:http";
import type { ModelCaller } from "../orchestrator";
import type { Provider } from "../providers";
import { generateId } from "../shared/generate-id";
import { logger } from "../shared/logger";
import type { Node, RequestMetric } from "../telemetry";
import { dispatchRequest } from "./dispatch-request";
import { executeProxyRequest } from "./execute-proxy-request";
import { buildNodes } from "./execute-proxy-request/build-nodes";
import { extractRequiredFeatures } from "./execute-proxy-request/extract-required-features";
import { filterHeaders } from "./filter-headers";
import { routingMemory } from "./routing-memory";

type ProxyModelCallerConfig = {
  qualifiedProviders: ReadonlyArray<Provider>;
  getMetricsForNode: (compoundKey: string) => RequestMetric[];
};

export function createProxyModelCaller(
  config: ProxyModelCallerConfig
): ModelCaller {
  return {
    complete: async (request) => {
      const requestId = generateId();
      const payloadStr = JSON.stringify(request.payload);
      const requiredFeatures = extractRequiredFeatures(request.payload);
      const nodes = buildNodes(config.qualifiedProviders);
      const headers: IncomingHttpHeaders = filterHeaders({});

      const boundDispatch = async (node: Node, payload: string) =>
        dispatchRequest(
          node,
          payload,
          config.qualifiedProviders,
          headers,
          requestId
        );

      logger.debug(
        `proxyModelCaller ${requestId} — ${String(config.qualifiedProviders.length)} providers, features: [${requiredFeatures.join(", ")}]`
      );

      try {
        const response = await executeProxyRequest({
          nodes,
          originalPayload: payloadStr,
          requiredFeatures,
          getMetricsForNode: config.getMetricsForNode,
          dispatchRequest: boundDispatch,
          sessionId: request.sessionId,
        });

        const body = await response.getBodyAsString();
        const sessionId = request.sessionId;
        const lastKey = sessionId
          ? routingMemory.getNodeAffinity(sessionId)
          : undefined;
        const usedNode = lastKey
          ? (nodes.find(
              (n) => lastKey === `${n.providerName}:${n.modelName}`
            ) ?? null)
          : null;

        return {
          status: response.status,
          ok: response.isOk(),
          body,
          provider: usedNode?.providerName ?? null,
          model: usedNode?.modelName ?? null,
        };
      } catch (err: unknown) {
        logger.debug(
          `proxyModelCaller ${requestId} — all providers failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return {
          status: 503,
          ok: false,
          body: err instanceof Error ? err.message : String(err),
          provider: null,
          model: null,
        };
      }
    },
  };
}
