import type { Provider } from "../providers";

export type ServerState = {
  getOverride: () => { provider: string; model: string } | null;
  isProviderDisabled: (providerName: string) => boolean;
  getProviders: () => ReadonlyArray<Provider>;
};

let currentState: ServerState | null = null;

export function initServerState(state: ServerState): void {
  currentState = state;
}

export function getServerState(): ServerState {
  if (!currentState) {
    throw new Error(
      "ServerState not initialized — call initServerState() first"
    );
  }
  return currentState;
}
