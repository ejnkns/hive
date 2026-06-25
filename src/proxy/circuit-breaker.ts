export class CircuitBreakerManager {
  private registry = new Map<string, number>();

  isTripped(compoundKey: string): boolean {
    const expiration = this.registry.get(compoundKey);
    if (!expiration) return false;
    if (Date.now() > expiration) {
      this.registry.delete(compoundKey);
      return false;
    }
    return true;
  }

  trip(compoundKey: string, durationMs = 30000): void {
    this.registry.set(compoundKey, Date.now() + durationMs);
  }

  clear(): void {
    this.registry.clear();
  }
}

export const circuitBreaker = new CircuitBreakerManager();
