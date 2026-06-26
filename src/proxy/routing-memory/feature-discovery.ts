export class FeatureDiscovery {
  private disabled = new Map<string, Set<string>>();

  hasDisabledFeatures(compoundKey: string, features: string[]): boolean {
    const forbidden = this.disabled.get(compoundKey);
    return forbidden !== undefined && features.some((f) => forbidden.has(f));
  }

  markUnsupported(compoundKey: string, features: string[]): void {
    let set = this.disabled.get(compoundKey);
    if (!set) {
      set = new Set();
      this.disabled.set(compoundKey, set);
    }
    for (const f of features) {
      set.add(f);
    }
  }

  clear(): void {
    this.disabled.clear();
  }
}
