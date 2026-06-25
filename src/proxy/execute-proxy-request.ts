import { selectBestNode } from "./node-selector";
import { circuitBreaker } from "./circuit-breaker";
import { empiricalDisabledFeatures } from "./feature-discovery";
import type { ProviderModelNode } from "../telemetry/score";
import type { RequestMetric } from "../telemetry/request-metric";
import { ProxyResponse } from "./proxy-response";

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
    if (availableNodes.length === 0) break;

    const node = selectBestNode(
      availableNodes,
      ctx.getMetricsForNode,
      ctx.requiredFeatures,
      ctx.sessionId
    );
    if (!node) break;

    const compoundKey = `${node.providerName}:${node.modelName}`;
    tried.add(compoundKey);
    attempts++;

    try {
      const response = await ctx.dispatchRequest(node, ctx.originalPayload);

      if (!response.isOk()) {
        const normalized = await response.getNormalizedError();

        if (normalized.type === "unsupported-feature") {
          if (!empiricalDisabledFeatures.has(compoundKey)) {
            empiricalDisabledFeatures.set(compoundKey, new Set());
          }
          ctx.requiredFeatures.forEach((f) =>
            empiricalDisabledFeatures.get(compoundKey)!.add(f)
          );
        }

        if (
          normalized.type === "rate-limit" ||
          normalized.type === "server-error" ||
          normalized.type === "auth-error"
        ) {
          circuitBreaker.trip(compoundKey, 30000);
        }

        continue;
      }

      return response;
    } catch {
      circuitBreaker.trip(compoundKey, 30000);
      continue;
    }
  }

  throw new Error(
    "Hive Router Error: All qualifying upstream endpoints failed execution."
  );
}
