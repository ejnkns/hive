import { logger } from "shared/logger";
import { loadCache, telemetryRecorder } from "telemetry";
import {
  discoverAndCacheModels,
  providers as staticProviders,
} from "../providers";
import { validateProvidersOnStartup } from "./application-lifecycle/validate-providers-on-startup";
import { setLastUsed } from "./last-used-state";
import { getProviders } from "./providers-state";

let discoveryTimer: NodeJS.Timeout | null = null;

export function start(): void {
  telemetryRecorder.start();
  validateProvidersOnStartup();
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
