const disabledProviders = new Set<string>();

export function disableProvider(providerName: string): void {
  disabledProviders.add(providerName);
}

export function enableProvider(providerName: string): void {
  disabledProviders.delete(providerName);
}

export function isProviderDisabled(providerName: string): boolean {
  return disabledProviders.has(providerName);
}
