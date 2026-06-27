let override: { provider: string; model: string } | null = null;

export function setOverride(provider: string, model: string): void {
  override = { provider, model };
}

export function clearOverride(): void {
  override = null;
}

export function getOverride(): { provider: string; model: string } | null {
  return override;
}
