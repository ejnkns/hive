import { generateId } from "shared/generate-id";
import { logger } from "shared/logger";
import { createTelemetrySink } from "telemetry";
import { mutateRequest } from "./mutate-request";
import { getProviders } from "./providers-state";
import { routeRequest } from "./route-request";

export function validateProvidersOnStartup(): void {
  for (const provider of getProviders()) {
    const key = process.env[provider.apiKeyEnvVar];
    if (!key) continue;

    const body = JSON.stringify({
      model: provider.defaultModel,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
    });

    const mutated = mutateRequest({
      originalHeaders: {},
      originalBody: body,
      targetProvider: provider,
      targetModel: provider.defaultModel,
    });

    void routeRequest({
      upstreamUrl: provider.chatEndpoint,
      mutated,
      timeoutMs: 5000,
      providerName: provider.name,
      modelName: provider.defaultModel,
      requestId: generateId(),
      telemetrySink: createTelemetrySink(),
    }).catch((err: unknown) => {
      logger.debug(
        `startup validation: ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
