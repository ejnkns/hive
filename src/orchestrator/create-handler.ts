/** @internal — wiring for the /api/orchestrate endpoint */

import type { Provider } from "../providers";
import { getMetricsForNode } from "../proxy/execute-proxy-request/get-metrics-for-node";
import { createProxyModelCaller } from "../proxy/proxy-model-caller";
import { logger } from "../shared/logger";
import type { Message } from "../shared/message";
import { loadCache } from "../telemetry";
import { createLocalToolRegistry } from "../tools/local-tool-registry";
import { orchestrate } from "./orchestrate";
import type { OrchestrationResult } from "./types";

export type HandleOrchestrate = (
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>
) => Promise<OrchestrationResult>;

type OrchestratorHandlerConfig = {
  getProviders: () => ReadonlyArray<Provider>;
  workspacePath: string;
};

export function createOrchestratorHandler(
  config: OrchestratorHandlerConfig
): HandleOrchestrate {
  return async (body, headers) => {
    const messages = (body.messages as Message[]) ?? [];
    const sessionId =
      (headers["x-session-id"] as string) ??
      (headers["x-session-affinity"] as string) ??
      "orchestrator-default";

    const qualified = config.getProviders().filter((p) => {
      const key = process.env[p.apiKeyEnvVar];
      return key && key.length > 0;
    });

    if (qualified.length === 0) {
      logger.debug("orchestrate — no configured providers available");
      return {
        messages,
        finishReason: "error",
        finalContent: "",
        iterations: 0,
        error: "No configured providers available",
      };
    }

    const cache = await loadCache();
    const boundGetMetricsForNode = (compoundKey: string) =>
      getMetricsForNode(compoundKey, cache);

    const modelCaller = createProxyModelCaller({
      qualifiedProviders: qualified,
      getMetricsForNode: boundGetMetricsForNode,
    });

    const toolRegistry = createLocalToolRegistry({
      workspacePath: config.workspacePath,
    });

    const maxIterations =
      typeof body.max_iterations === "number" ? body.max_iterations : undefined;

    logger.debug(
      `orchestrate — ${String(qualified.length)} providers, session ${sessionId}`
    );

    return orchestrate(
      {
        messages,
        toolRegistry,
        toolContext: { sessionId, workspacePath: config.workspacePath },
        maxIterations,
        sessionId,
      },
      modelCaller
    );
  };
}
