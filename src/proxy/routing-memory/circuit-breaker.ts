export class CircuitBreaker {
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

  trip(compoundKey: string, durationMs: number): void {
    this.registry.set(compoundKey, Date.now() + durationMs);
  }

  clear(): void {
    this.registry.clear();
  }

  getActiveBreakers(): Record<string, number> {
    const active: Record<string, number> = {};
    const now = Date.now();
    for (const [key, exp] of this.registry.entries()) {
      if (exp > now) {
        active[key] = exp;
      }
    }
    return active;
  }
}
