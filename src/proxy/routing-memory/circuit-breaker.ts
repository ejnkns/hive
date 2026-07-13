export function createCircuitBreaker() {
  const registry = new Map<string, number>();

  function isTripped(compoundKey: string): boolean {
    const expiration = registry.get(compoundKey);
    if (!expiration) return false;
    if (Date.now() > expiration) {
      registry.delete(compoundKey);
      return false;
    }
    return true;
  }

  function trip(compoundKey: string, durationMs: number): void {
    registry.set(compoundKey, Date.now() + durationMs);
  }

  function clear(): void {
    registry.clear();
  }

  function getActiveBreakers(): Record<string, number> {
    const active: Record<string, number> = {};
    const now = Date.now();
    for (const [key, exp] of registry.entries()) {
      if (exp > now) {
        active[key] = exp;
      }
    }
    return active;
  }

  function getCooldownSec(compoundKey: string): number {
    const expiration = registry.get(compoundKey);
    if (!expiration) return 0;
    return Math.max(0, Math.round((expiration - Date.now()) / 1000));
  }

  return { isTripped, trip, clear, getActiveBreakers, getCooldownSec };
}
