import { logger } from "../shared/logger";
import type { NormalizedErrorType } from "./proxy-response";
import { createCircuitBreaker } from "./routing-memory/circuit-breaker";
import { createFeatureDiscovery } from "./routing-memory/feature-discovery";
import { createSessionRegistry } from "./routing-memory/session-registry";

const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const BREAKER_TRIGGERS = new Set<NormalizedErrorType>([
  "rate-limit",
  "server-error",
  "auth-error",
]);

export function createRoutingMemory() {
  const breaker = createCircuitBreaker();
  const features = createFeatureDiscovery();
  const sessions = createSessionRegistry();

  function isNodeEligible(
    compoundKey: string,
    requiredFeatures: string[]
  ): boolean {
    if (breaker.isTripped(compoundKey)) {
      logger.debug(`${compoundKey} — ineligible: circuit breaker tripped`);
      return false;
    }
    if (features.hasDisabledFeatures(compoundKey, requiredFeatures)) {
      logger.debug(
        `${compoundKey} — ineligible: features [${requiredFeatures.join(", ")}] unsupported`
      );
      return false;
    }
    return true;
  }

  function isCircuitBroken(compoundKey: string): boolean {
    return breaker.isTripped(compoundKey);
  }

  function hasUnsupportedFeatures(
    compoundKey: string,
    requiredFeatures: string[]
  ): boolean {
    return features.hasDisabledFeatures(compoundKey, requiredFeatures);
  }

  function getCooldownSec(compoundKey: string): number {
    return breaker.getCooldownSec(compoundKey);
  }

  function recordUpstreamError(
    compoundKey: string,
    errorType: NormalizedErrorType,
    requiredFeatures: string[]
  ): void {
    if (errorType === "unsupported-feature") {
      logger.debug(
        `${compoundKey} — marked unsupported features: [${requiredFeatures.join(", ")}]`
      );
      features.markUnsupported(compoundKey, requiredFeatures);
      return;
    }
    if (BREAKER_TRIGGERS.has(errorType)) {
      logger.debug(
        `${compoundKey} — circuit breaker tripped (${errorType}, ${String(CIRCUIT_BREAKER_COOLDOWN_MS)}ms cooldown)`
      );
      breaker.trip(compoundKey, CIRCUIT_BREAKER_COOLDOWN_MS);
    }
  }

  function recordNetworkFailure(compoundKey: string): void {
    logger.debug(
      `${compoundKey} — circuit breaker tripped (network failure, ${String(CIRCUIT_BREAKER_COOLDOWN_MS)}ms cooldown)`
    );
    breaker.trip(compoundKey, CIRCUIT_BREAKER_COOLDOWN_MS);
  }

  function getNodeAffinity(sessionId: string): string | undefined {
    return sessions.get(sessionId);
  }

  function setNodeAffinity(sessionId: string, compoundKey: string): void {
    sessions.set(sessionId, compoundKey);
  }

  function reset(): void {
    breaker.clear();
    features.clear();
    sessions.clear();
  }

  function getStates() {
    return {
      trippedBreakers: breaker.getActiveBreakers(),
      disabledFeatures: features.getDisabledFeatures(),
    };
  }

  return {
    isNodeEligible,
    isCircuitBroken,
    hasUnsupportedFeatures,
    getCooldownSec,
    recordUpstreamError,
    recordNetworkFailure,
    getNodeAffinity,
    setNodeAffinity,
    reset,
    getStates,
  };
}

export const routingMemory = createRoutingMemory();
