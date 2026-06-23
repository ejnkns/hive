import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs, readFileSync } from "node:fs";
import { allProviders } from "./registry";
import { logger } from "../hive/shared/logger";

export type CachedProvider = {
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

export const PROVIDER_PREFERENCES: Record<string, string[]> = {
  groq: [
    "deepseek-r1-distill-llama-70b",
    "llama-3.3-70b-versatile",
    "mixtral-8x7b-32768",
  ],
  "google-ai": [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-2.0-flash-exp",
  ],
  sambanova: [
    "DeepSeek-R1",
    "Meta-Llama-3.3-70B-Instruct",
  ],
  "nvidia-nim": [
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
    "meta/llama-3.1-405b-instruct",
  ],
  "github-models": [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "claude-3-5-sonnet",
    "llama-3.3-70b-instruct",
  ],
  cerebras: [
    "llama-3.3-70b",
    "llama-3.1-8b",
  ],
  mistral: [
    "codestral-latest",
    "mistral-large-latest",
    "mistral-small-latest",
  ],
  "opencode-zen": [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4-mini",
    "deepseek-v4-flash-free",
    "qwen3.6-plus-free",
  ],
};

const HIVE_DIR = join(homedir(), ".hive");
const MODELS_CACHE_PATH = join(HIVE_DIR, "models-cache.json");

export async function loadModelCache(): Promise<ModelCache | null> {
  try {
    logger.debug(`Reading model cache from: ${MODELS_CACHE_PATH}`);
    const data = await fs.readFile(MODELS_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(data);
    logger.debug("Successfully loaded model cache from disk");
    return parsed;
  } catch (err: any) {
    logger.debug(`Model cache not found or failed to parse on disk: ${err.message}`);
    return null;
  }
}

export function loadModelCacheSync(): ModelCache | null {
  try {
    logger.debug(`Synchronously reading model cache from: ${MODELS_CACHE_PATH}`);
    const data = readFileSync(MODELS_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(data);
    logger.debug("Successfully loaded model cache synchronously from disk");
    return parsed;
  } catch (err: any) {
    logger.debug(`Model cache not found or failed to parse synchronously on disk: ${err.message}`);
    return null;
  }
}

export async function saveModelCache(cache: ModelCache): Promise<void> {
  try {
    logger.debug(`Creating/ensuring directory exists for models cache: ${HIVE_DIR}`);
    await fs.mkdir(HIVE_DIR, { recursive: true });
    logger.debug(`Writing model cache to: ${MODELS_CACHE_PATH}`);
    await fs.writeFile(MODELS_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    logger.debug("Successfully wrote model cache to disk");
  } catch (err: any) {
    logger.debug(`Failed to write model cache to disk: ${err.message}`);
  }
}

export function selectDefaultModel(
  providerName: string,
  fetchedModels: string[],
  fallbackDefault: string,
): string {
  const preferences = PROVIDER_PREFERENCES[providerName];
  if (!preferences) return fallbackDefault;

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

  // Otherwise, return the first fetched model, or fallbackDefault if fetched is empty
  return fetchedModels[0] || fallbackDefault;
}

export async function fetchProviderModels(
  baseUrl: string,
  apiKeyEnvVar: string,
): Promise<string[]> {
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`API key missing: ${apiKeyEnvVar}`);
  }

  logger.debug(`API key '${apiKeyEnvVar}' found in environment for baseUrl: ${baseUrl}`);

  let url = baseUrl;
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }

  const modelsEndpoint = url.endsWith("/v1")
    ? `${url}/models`
    : `${url}/v1/models`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000); // 8 second timeout

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
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    const data = (await response.json()) as any;
    if (data && Array.isArray(data.data)) {
      const models = data.data
        .map((m: any) => m.id)
        .filter((id: any) => typeof id === "string");
      logger.debug(`Successfully fetched ${models.length} models from baseUrl: ${baseUrl}`);
      return models;
    }

    throw new Error("Invalid response format: 'data' array not found");
  } catch (error: any) {
    clearTimeout(id);
    logger.debug(`Failed to fetch models from baseUrl ${baseUrl}: ${error.message}`);
    throw error;
  }
}

export async function discoverAndCacheModels(
  force = false,
): Promise<ModelCache> {
  const currentCache = await loadModelCache();
  const now = Date.now();

  // If cache is fresh and not forced, return it immediately
  if (
    !force &&
    currentCache &&
    now - currentCache.lastCheckTime < 10 * 60 * 1000
  ) {
    logger.debug("Model cache is fresh (less than 10 mins old). Skipping discovery.");
    return currentCache;
  }

  logger.debug("Triggering background model discovery across providers...");
  const updatedProviders: CachedProvider[] = [];

  for (const provider of allProviders) {
    const key = process.env[provider.apiKeyEnvVar];
    const cached = currentCache?.providers.find((p) => p.name === provider.name);

    if (key && key.length > 0) {
      try {
        const fetchedModels = await fetchProviderModels(
          provider.baseUrl,
          provider.apiKeyEnvVar,
        );
        const bestDefault = selectDefaultModel(
          provider.name,
          fetchedModels,
          provider.defaultModel,
        );

        updatedProviders.push({
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          models: fetchedModels.length > 0 ? fetchedModels : [...provider.models],
          defaultModel: bestDefault,
          lastChecked: new Date().toISOString(),
          lastCheckStatus: "success",
          lastCheckError: null,
        });
      } catch (err: any) {
        updatedProviders.push({
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          models: cached?.models || [...provider.models],
          defaultModel: cached?.defaultModel || provider.defaultModel,
          lastChecked: new Date().toISOString(),
          lastCheckStatus: "failed",
          lastCheckError: err.message || String(err),
        });
      }
    } else {
      logger.debug(`No API key found in env for provider '${provider.name}' (${provider.apiKeyEnvVar}). Skipping discovery.`);
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
