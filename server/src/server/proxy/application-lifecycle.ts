import { generateId } from "shared/generate-id";
import { logger } from "shared/logger";
import {
  createTelemetrySink,
  loadCache,
  startHeartbeat as startTelemetryHeartbeat,
  telemetryRecorder,
} from "telemetry";
import {
  discoverAndCacheModels,
  providers as staticProviders,
} from "../providers";
import { setLastUsed } from "./last-used-state";
import { mutateRequest } from "./mutate-request";
import { getProviders } from "./providers-state";
import { routeRequest } from "./route-request";

let heartbeatTimer: NodeJS.Timeout | null = null;
let discoveryTimer: NodeJS.Timeout | null = null;

export function start(): void {
  telemetryRecorder.start();
  startHeartbeat();
  void loadLastUsed();
  void triggerBackgroundDiscovery();
  discoveryTimer = setInterval(
    () => {
      void triggerBackgroundDiscovery();
    },
    60 * 60 * 1000
  );
}

export function shutdown(): void {
  telemetryRecorder.stop();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}

async function loadLastUsed(): Promise<void> {
  try {
    const cache = await loadCache();
    const latest = cache.metrics
      .filter((m) => m.success && m.source === "user")
      .sort((a, b) => b.timestamp - a.timestamp)
      .at(0);
    if (latest !== undefined) {
      setLastUsed(latest.provider, latest.model);
    }
  } catch (err: unknown) {
    logger.debug(
      `loadLastUsed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function triggerBackgroundDiscovery(): Promise<void> {
  try {
    const cache = await discoverAndCacheModels(staticProviders);
    for (const p of getProviders()) {
      const cached = cache.providers.find((cp) => cp.name === p.name);
      if (cached) {
        p.models = [...cached.models];
        p.defaultModel = cached.defaultModel;
      }
    }
  } catch (err: unknown) {
    logger.debug(
      `triggerBackgroundDiscovery: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function startHeartbeat(): void {
  heartbeatTimer = startTelemetryHeartbeat(async () => {
    for (const provider of getProviders()) {
      const key = process.env[provider.apiKeyEnvVar];
      if (!key) continue;

      try {
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
        await routeRequest({
          upstreamUrl: provider.chatEndpoint,
          mutated,
          timeoutMs: 5000,
          providerName: provider.name,
          modelName: provider.defaultModel,
          requestId: generateId(),
          source: "heartbeat",
          telemetrySink: createTelemetrySink(),
        });
      } catch (err: unknown) {
        logger.debug(
          `heartbeat: ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  });
}
