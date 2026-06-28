import { promises as fs } from "node:fs";
import { HIVE_DIR, ModelCache, MODELS_CACHE_PATH } from "../model-discovery";
import { logger } from "../../shared/logger";

export async function saveModelCache(cache: ModelCache): Promise<void> {
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
