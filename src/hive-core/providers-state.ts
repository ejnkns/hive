import type { Provider } from "../providers";
import { loadProviders } from "../server";

const initialProviders = loadProviders();
export const providers = initialProviders.map((p) => ({
  name: p.name,
  displayName: p.displayName,
  baseUrl: p.baseUrl,
  apiKeyEnvVar: p.apiKeyEnvVar,
  models: [...p.models],
  defaultModel: p.defaultModel,
}));

export function getProviders(): ReadonlyArray<Provider> {
  return providers;
}
