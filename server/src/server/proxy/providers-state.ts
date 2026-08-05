import type { Provider } from "../providers";
import type { ModelCache } from "../providers/model-discovery";
import { getServerState } from "./server-state";

let providers: ReadonlyArray<Provider> | null = null;

function ensureProviders(): ReadonlyArray<Provider> {
  if (!providers) {
    const loaded = getServerState().getProviders();
    providers = loaded.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      chatEndpoint: p.chatEndpoint,
      modelsEndpoint: p.modelsEndpoint,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: [...p.models],
      defaultModel: p.defaultModel,
    }));
  }
  return providers;
}

export function getProviders(): ReadonlyArray<Provider> {
  return ensureProviders();
}

// Background model discovery rebuilds the memo rather than mutating the cached
// provider objects, so consumers never observe in-place mutation through the
// getter.
export function applyDiscoveredModels(cache: ModelCache): void {
  providers = ensureProviders().map((p) => {
    const cached = cache.providers.find((cp) => cp.name === p.name);
    if (!cached) return p;
    return {
      ...p,
      models: [...cached.models],
      defaultModel: cached.defaultModel,
    };
  });
}
