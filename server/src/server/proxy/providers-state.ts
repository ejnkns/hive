import type { Provider } from "../providers";
import { getServerState } from "./server-state";

let providers: ReadonlyArray<Provider> | null = null;

function ensureProviders(): ReadonlyArray<Provider> {
  if (!providers) {
    const loaded = getServerState().getProviders();
    providers = loaded.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
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
