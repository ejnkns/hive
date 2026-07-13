export function createFeatureDiscovery() {
  const disabled = new Map<string, Set<string>>();

  function hasDisabledFeatures(
    compoundKey: string,
    features: string[]
  ): boolean {
    const forbidden = disabled.get(compoundKey);
    return forbidden !== undefined && features.some((f) => forbidden.has(f));
  }

  function markUnsupported(compoundKey: string, features: string[]): void {
    let set = disabled.get(compoundKey);
    if (!set) {
      set = new Set();
      disabled.set(compoundKey, set);
    }
    for (const f of features) {
      set.add(f);
    }
  }

  function clear(): void {
    disabled.clear();
  }

  function getDisabledFeatures(): Record<string, string[]> {
    const res: Record<string, string[]> = {};
    for (const [key, set] of disabled.entries()) {
      res[key] = Array.from(set);
    }
    return res;
  }

  return { hasDisabledFeatures, markUnsupported, clear, getDisabledFeatures };
}
