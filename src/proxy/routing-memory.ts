import { CircuitBreaker } from "./routing-memory/circuit-breaker";
import { FeatureDiscovery } from "./routing-memory/feature-discovery";
import { SessionRegistry } from "./routing-memory/session-registry";
import type { NormalizedErrorType } from "../utils/error-normalizer";

const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const BREAKER_TRIGGERS = new Set<NormalizedErrorType>([
  "rate-limit",
  "server-error",
  "auth-error",
]);

export class RoutingMemory {
  private breaker = new CircuitBreaker();
  private features = new FeatureDiscovery();
  private sessions = new SessionRegistry();

  isNodeEligible(compoundKey: string, requiredFeatures: string[]): boolean {
    if (this.breaker.isTripped(compoundKey)) return false;
    if (this.features.hasDisabledFeatures(compoundKey, requiredFeatures))
      return false;
    return true;
  }

  recordUpstreamError(
    compoundKey: string,
    errorType: NormalizedErrorType,
    requiredFeatures: string[]
  ): void {
    if (errorType === "unsupported-feature") {
      this.features.markUnsupported(compoundKey, requiredFeatures);
      return;
    }
    if (BREAKER_TRIGGERS.has(errorType)) {
      this.breaker.trip(compoundKey, CIRCUIT_BREAKER_COOLDOWN_MS);
    }
  }

  recordNetworkFailure(compoundKey: string): void {
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
}

export const routingMemory = new RoutingMemory();
