import { logger } from "../shared/logger";
import type { NormalizedErrorType } from "./proxy-response";
import { CircuitBreaker } from "./routing-memory/circuit-breaker";
import { FeatureDiscovery } from "./routing-memory/feature-discovery";
import { SessionRegistry } from "./routing-memory/session-registry";

const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const BREAKER_TRIGGERS = new Set<NormalizedErrorType>(["rate-limit", "server-error", "auth-error"]);

export class RoutingMemory {
  private breaker = new CircuitBreaker();
  private features = new FeatureDiscovery();
  private sessions = new SessionRegistry();

  isNodeEligible(compoundKey: string, requiredFeatures: string[]): boolean {
    if (this.breaker.isTripped(compoundKey)) {
      logger.debug(`${compoundKey} — ineligible: circuit breaker tripped`);
      return false;
    }
    if (this.features.hasDisabledFeatures(compoundKey, requiredFeatures)) {
      logger.debug(`${compoundKey} — ineligible: features [${requiredFeatures.join(", ")}] unsupported`);
      return false;
    }
    return true;
  }

  isCircuitBroken(compoundKey: string): boolean {
    return this.breaker.isTripped(compoundKey);
  }

  hasUnsupportedFeatures(compoundKey: string, requiredFeatures: string[]): boolean {
    return this.features.hasDisabledFeatures(compoundKey, requiredFeatures);
  }

  recordUpstreamError(compoundKey: string, errorType: NormalizedErrorType, requiredFeatures: string[]): void {
    if (errorType === "unsupported-feature") {
      logger.debug(`${compoundKey} — marked unsupported features: [${requiredFeatures.join(", ")}]`);
      this.features.markUnsupported(compoundKey, requiredFeatures);
      return;
    }
    if (BREAKER_TRIGGERS.has(errorType)) {
      logger.debug(
        `${compoundKey} — circuit breaker tripped (${errorType}, ${String(CIRCUIT_BREAKER_COOLDOWN_MS)}ms cooldown)`
      );
      this.breaker.trip(compoundKey, CIRCUIT_BREAKER_COOLDOWN_MS);
    }
  }

  recordNetworkFailure(compoundKey: string): void {
    logger.debug(
      `${compoundKey} — circuit breaker tripped (network failure, ${String(CIRCUIT_BREAKER_COOLDOWN_MS)}ms cooldown)`
    );
    this.breaker.trip(compoundKey, CIRCUIT_BREAKER_COOLDOWN_MS);
  }

  getNodeAffinity(sessionId: string): string | undefined {
    return this.sessions.get(sessionId);
  }

  setNodeAffinity(sessionId: string, compoundKey: string): void {
    this.sessions.set(sessionId, compoundKey);
  }

  reset(): void {
    this.breaker.clear();
    this.features.clear();
    this.sessions.clear();
  }

  getStates() {
    return {
      trippedBreakers: this.breaker.getActiveBreakers(),
      disabledFeatures: this.features.getDisabledFeatures(),
    };
  }
}

export const routingMemory = new RoutingMemory();
