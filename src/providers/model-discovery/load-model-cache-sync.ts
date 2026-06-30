import { readFileSync } from "node:fs";
import { logger } from "../../shared/logger";
import type { ModelCache } from "../model-discovery";
import { MODELS_CACHE_PATH } from "./shared/paths";

export function loadModelCacheSync(): ModelCache | null {
  try {
    logger.debug(`Synchronously reading model cache from: ${MODELS_CACHE_PATH}`);
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
