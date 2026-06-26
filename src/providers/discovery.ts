import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs, readFileSync } from "node:fs";
import { buildModelsEndpoint, type Provider } from "./registry";
import { logger } from "../hive/shared/logger";

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

type ModelCache = {
  lastCheckTime: number;
  providers: CachedProvider[];
};

const HIVE_DIR = join(homedir(), ".hive");
const MODELS_CACHE_PATH = join(HIVE_DIR, "models-cache.json");

async function loadModelCache(): Promise<ModelCache | null> {
  try {
    logger.debug(`Reading model cache from: ${MODELS_CACHE_PATH}`);
    const data = await fs.readFile(MODELS_CACHE_PATH, "utf-8");
    // JSON.parse returns unknown at runtime; cast justified by file format
    const parsed = JSON.parse(data) as ModelCache;
    logger.debug("Successfully loaded model cache from disk");
    return parsed;
  } catch (err: unknown) {
    logger.debug(
      `Model cache not found or failed to parse on disk: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export function loadModelCacheSync(): ModelCache | null {
  try {
    logger.debug(
      `Synchronously reading model cache from: ${MODELS_CACHE_PATH}`
    );
    const data = readFileSync(MODELS_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(data) as ModelCache;
    logger.debug("Successfully loaded model cache synchronously from disk");
    return parsed;
  } catch (err: unknown) {
    logger.debug(
      `Model cache not found or failed to parse synchronously on disk: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

async function saveModelCache(cache: ModelCache): Promise<void> {
  try {
    logger.debug(
      `Creating/ensuring directory exists for models cache: ${HIVE_DIR}`
    );
    await fs.mkdir(HIVE_DIR, { recursive: true });
    logger.debug(`Writing model cache to: ${MODELS_CACHE_PATH}`);
    await fs.writeFile(
      MODELS_CACHE_PATH,
      JSON.stringify(cache, null, 2),
      "utf-8"
    );
    logger.debug("Successfully wrote model cache to disk");
  } catch (err: unknown) {
    logger.debug(
      `Failed to write model cache to disk: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function selectDefaultModel(
  fetchedModels: string[],
  fallbackDefault: string,
  preferences?: string[]
): string {
  if (!preferences || preferences.length === 0) return fallbackDefault;

  // Find the first model in our prioritized preference list that exists in the fetched list
  for (const preferred of preferences) {
    if (fetchedModels.includes(preferred)) {
      return preferred;
    }
  }

  // If none matched, check if our hardcoded baseline default is in the fetched list
  if (fetchedModels.includes(fallbackDefault)) {
    return fallbackDefault;
  }

  // Otherwise, score the fetched models to select the most capable, non-utility chat model
  if (fetchedModels.length === 0) {
    return fallbackDefault;
  }

  let bestModel = fetchedModels[0];
  let highestScore = -Infinity;

  for (const m of fetchedModels) {
    const lower = m.toLowerCase();
    let score = 0;

    // Heavily penalize non-chat utility/specialized models to avoid severe failures
    if (
      ["guard", "embed", "moderation", "ocr", "translate", "vision"].some(
        (kw) => lower.includes(kw)
      )
    ) {
      score -= 1000;
    }
    // Prioritize high-capacity / free flagship models
    if (["120b", "405b"].some((kw) => lower.includes(kw))) score += 100;
    if (lower.includes("70b")) score += 80;
    if (lower.includes("-free")) score += 50;
    if (
      ["large", "pro", "instruct", "r1", "plus"].some((kw) =>
        lower.includes(kw)
      )
    )
      score += 20;
    // Deprioritize small models
    if (
      ["8b", "7b", "3b", "1b", "mini", "small", "flash", "lite"].some((kw) =>
        lower.includes(kw)
      )
    )
      score -= 40;

    if (score > highestScore) {
      highestScore = score;
      bestModel = m;
    }
  }
  return bestModel;
}

async function fetchProviderModels(
  baseUrl: string,
  apiKeyEnvVar: string
): Promise<string[]> {
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`API key missing: ${apiKeyEnvVar}`);
  }

  logger.debug(
    `API key '${apiKeyEnvVar}' found in environment for baseUrl: ${baseUrl}`
  );

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
      throw new Error(
        `HTTP ${String(response.status)}: ${text || response.statusText}`
      );
    }

    const data: ModelListResponse =
      (await response.json()) as ModelListResponse;
    if (Array.isArray(data.data)) {
      const models = data.data
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string");
      logger.debug(
        `Successfully fetched ${String(models.length)} models from baseUrl: ${baseUrl}`
      );
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

export async function discoverAndCacheModels(
  providers: Provider[],
  force = false
): Promise<ModelCache> {
  const currentCache = await loadModelCache();
  const now = Date.now();

  // If cache is fresh and not forced, return it immediately
  if (
    !force &&
    currentCache &&
    now - currentCache.lastCheckTime < 10 * 60 * 1000
  ) {
    logger.debug(
      "Model cache is fresh (less than 10 mins old). Skipping discovery."
    );
    return currentCache;
  }

  logger.debug("Triggering background model discovery across providers...");
  const updatedProviders: CachedProvider[] = [];

  for (const provider of providers) {
    const key = process.env[provider.apiKeyEnvVar];
    const cached = currentCache?.providers.find(
      (p) => p.name === provider.name
    );

    if (key && key.length > 0) {
      try {
        const fetchedModels = await fetchProviderModels(
          provider.baseUrl,
          provider.apiKeyEnvVar
        );
        const bestDefault = selectDefaultModel(
          fetchedModels,
          provider.defaultModel,
          provider.modelPreferences
        );

        updatedProviders.push({
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          models:
            fetchedModels.length > 0 ? fetchedModels : [...provider.models],
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
          models: cached?.models || [...provider.models],
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
        models: cached?.models || [...provider.models],
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
