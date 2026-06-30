import { promises as fs } from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "../shared/hive-dir";
import { logger } from "../shared/logger";
import type { DerivedMetrics } from "./derived-metrics";
import type { RequestMetric } from "./request-metric";

/** @package */
export type ModelScore = {
  provider: string;
  model: string;
  score: number;
  derived: DerivedMetrics;
  updatedAt: number;
};

type TelemetryCache = {
  metrics: RequestMetric[];
  scores: ModelScore[];
};

const TELEMETRY_PATH = join(HIVE_DIR, "telemetry-cache.json");

async function ensureHiveDir(): Promise<void> {
  try {
    await fs.mkdir(HIVE_DIR, { recursive: true });
  } catch (err: unknown) {
    logger.debug(`cache: failed to create telemetry directory: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function loadCache(): Promise<TelemetryCache> {
  try {
    const data = await fs.readFile(TELEMETRY_PATH, "utf-8");
    // JSON.parse returns unknown; cast justified by runtime validation below
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (Array.isArray(parsed.metrics) && Array.isArray(parsed.scores)) {
      // cast justified: we validated the shape at runtime
      return parsed as TelemetryCache;
    }
    logger.debug(`cache: loadCache — invalid shape, starting fresh`);
  } catch (err: unknown) {
    logger.debug(`cache: loadCache — not found or parse error: ${err instanceof Error ? err.message : String(err)}`);
    // file doesn't exist or invalid — start fresh
  }
  return { metrics: [], scores: [] };
}

export async function saveCache(cache: TelemetryCache): Promise<void> {
  try {
    await ensureHiveDir();
    await fs.writeFile(TELEMETRY_PATH, JSON.stringify(cache, null, 2), "utf-8");
    logger.debug(
      `cache: saveCache — wrote ${String(cache.metrics.length)} metrics, ${String(cache.scores.length)} scores`
    );
  } catch (err: unknown) {
    logger.debug(`cache: saveCache — failed to write: ${err instanceof Error ? err.message : String(err)}`);
  }
}
