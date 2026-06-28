import { allProviders, type Provider } from "../providers/registry";
import { loadModelCacheSync } from "../providers/model-discovery";

export function loadProviders(): ReadonlyArray<Provider> {
  const cache = loadModelCacheSync();
  const providers = allProviders.map((p) => {
    const cached = cache?.providers.find((cp) => cp.name === p.name);
    return {
      name: p.name,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: cached ? [...cached.models] : [...p.models],
      defaultModel: cached ? cached.defaultModel : p.defaultModel,
    };
  });

  return providers;
}
