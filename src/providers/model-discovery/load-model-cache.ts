import { logger } from "../../shared/logger";
import { ModelCache, MODELS_CACHE_PATH } from "../model-discovery";
import { promises as fs } from "node:fs";

export async function loadModelCache(): Promise<ModelCache | null> {
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
