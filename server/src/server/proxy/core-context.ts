import type { Provider } from "../providers/providers";

export type ServerState = {
  getOverride: () => { provider: string; model: string } | null;
  isProviderDisabled: (providerName: string) => boolean;
  getProviders: () => ReadonlyArray<Provider>;
};

let currentState: ServerState | null = null;

export function initCore(state: ServerState): void {
  currentState = state;
}

export function getCoreState(): ServerState {
  if (!currentState) {
    throw new Error("Core not initialized — call initCore() first");
  }
  return currentState;
}
