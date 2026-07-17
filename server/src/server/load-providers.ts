import {
  providers as allProviders,
  loadModelCacheSync,
  type Provider,
} from "./providers";

export function loadProviders(): ReadonlyArray<Provider> {
  const cache = loadModelCacheSync();
  const providers = allProviders.map((p) => {
    const cached = cache?.providers.find((cp) => cp.name === p.name);
    return {
      name: p.name,
      displayName: p.displayName,
      chatEndpoint: p.chatEndpoint,
      modelsEndpoint: p.modelsEndpoint,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: cached ? [...cached.models] : [...p.models],
      defaultModel: cached ? cached.defaultModel : p.defaultModel,
    };
  });

  return providers;
}
