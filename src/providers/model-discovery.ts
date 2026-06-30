import { logger } from "../shared/logger";
import { loadModelCache } from "./model-discovery/load-model-cache";
import { loadModelCacheSync } from "./model-discovery/load-model-cache-sync";
import { saveModelCache } from "./model-discovery/save-model-cache";
import { selectDefaultModel } from "./model-discovery/select-default-model";
import { buildModelsEndpoint, getModelId, type Provider } from "./registry";

export { loadModelCacheSync };

type ModelListResponse = {
  data: Array<{ id: string }>;
};

type CachedProvider = {
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: string[];
  defaultModel: string;
  lastChecked?: string;
  lastCheckStatus?: "success" | "failed";
  lastCheckError?: string | null;
};

export type ModelCache = {
  lastCheckTime: number;
  providers: CachedProvider[];
};

async function fetchProviderModels(baseUrl: string, apiKeyEnvVar: string): Promise<string[]> {
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`API key missing: ${apiKeyEnvVar}`);
  }

  logger.debug(`API key '${apiKeyEnvVar}' found in environment for baseUrl: ${baseUrl}`);

  const modelsEndpoint = buildModelsEndpoint(baseUrl);

  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort();
  }, 8000); // 8 second timeout

  try {
    logger.debug(`Fetching models from endpoint: ${modelsEndpoint}`);
    const response = await fetch(modelsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${String(response.status)}: ${text || response.statusText}`);
    }

    // JSON.parse returns unknown; response.json() is typed as any, cast to expected shape
    const data: ModelListResponse = (await response.json()) as ModelListResponse;
    if (Array.isArray(data.data)) {
      const models = data.data.map((m) => m.id).filter((id): id is string => typeof id === "string");
      logger.debug(`Successfully fetched ${String(models.length)} models from baseUrl: ${baseUrl}`);
      return models;
    }

    throw new Error("Invalid response format: 'data' array not found");
  } catch (error: unknown) {
    clearTimeout(id);
    logger.debug(
      `Failed to fetch models from baseUrl ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

export async function discoverAndCacheModels(providers: Provider[], force = false): Promise<ModelCache> {
  const currentCache = await loadModelCache();
  const now = Date.now();

  // If cache is fresh and not forced, return it immediately
  if (!force && currentCache && now - currentCache.lastCheckTime < 10 * 60 * 1000) {
    logger.debug("Model cache is fresh (less than 10 mins old). Skipping discovery.");
    return currentCache;
  }

  logger.debug("Triggering background model discovery across providers...");
  const updatedProviders: CachedProvider[] = [];

  for (const provider of providers) {
    const key = process.env[provider.apiKeyEnvVar];
    const cached = currentCache?.providers.find((p: CachedProvider) => p.name === provider.name);

    if (key && key.length > 0) {
      try {
        const fetchedModels = await fetchProviderModels(provider.baseUrl, provider.apiKeyEnvVar);
        const bestDefault = selectDefaultModel(fetchedModels, provider.defaultModel, provider.modelPreferences);

        updatedProviders.push({
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          models: fetchedModels.length > 0 ? fetchedModels : provider.models.map(getModelId),
          defaultModel: bestDefault,
          lastChecked: new Date().toISOString(),
          lastCheckStatus: "success",
          lastCheckError: null,
        });
      } catch (err: unknown) {
        updatedProviders.push({
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          models: cached?.models || provider.models.map(getModelId),
          defaultModel: cached?.defaultModel || provider.defaultModel,
          lastChecked: new Date().toISOString(),
          lastCheckStatus: "failed",
          lastCheckError: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.debug(
        `No API key found in env for provider '${provider.name}' (${provider.apiKeyEnvVar}). Skipping discovery.`
      );
      updatedProviders.push({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKeyEnvVar: provider.apiKeyEnvVar,
        models: cached?.models || provider.models.map(getModelId),
        defaultModel: cached?.defaultModel || provider.defaultModel,
        lastChecked: cached?.lastChecked,
        lastCheckStatus: cached?.lastCheckStatus,
        lastCheckError: cached?.lastCheckError,
      });
    }
  }

  const newCache: ModelCache = {
    lastCheckTime: now,
    providers: updatedProviders,
  };

  await saveModelCache(newCache);
  return newCache;
}
