import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import type { ProviderState } from "../providers/registry";
import type { RequestMetrics } from "./sliding-window";
import { logger } from "../hive/shared/logger";

export type TelemetryState = {
  metrics: RequestMetrics[];
  providerStates: ProviderState[];
};

const HIVE_DIR = join(homedir(), ".hive");
const TELEMETRY_PATH = join(HIVE_DIR, "telemetry-cache.json");

let state: TelemetryState = { metrics: [], providerStates: [] };
let isLoaded = false;

async function ensureHiveDir(): Promise<void> {
  try {
    logger.debug(`Creating/ensuring telemetry directory exists at: ${HIVE_DIR}`);
    await fs.mkdir(HIVE_DIR, { recursive: true });
  } catch (err: any) {
    logger.debug(`Failed to create directory ${HIVE_DIR}: ${err.message}`);
  }
}

export async function loadState(): Promise<TelemetryState> {
  if (!isLoaded) {
    try {
      logger.debug(`Reading telemetry cache from: ${TELEMETRY_PATH}`);
      const data = await fs.readFile(TELEMETRY_PATH, "utf-8");
      const parsed = JSON.parse(data);
      if (
        parsed &&
        Array.isArray(parsed.metrics) &&
        Array.isArray(parsed.providerStates)
      ) {
        state = parsed;
        logger.debug("Successfully read and loaded telemetry cache from disk");
      }
    } catch (err: any) {
      logger.debug(`Telemetry cache not found or failed to parse, starting fresh: ${err.message}`);
    }
    isLoaded = true;
  }
  return {
    ...state,
    metrics: [...state.metrics],
    providerStates: [...state.providerStates],
  };
}

export async function saveState(newState: TelemetryState): Promise<void> {
  state = {
    ...newState,
    metrics: [...newState.metrics],
    providerStates: [...newState.providerStates],
  };
  try {
    await ensureHiveDir();
    logger.debug(`Writing telemetry cache to: ${TELEMETRY_PATH}`);
    await fs.writeFile(TELEMETRY_PATH, JSON.stringify(state, null, 2), "utf-8");
    logger.debug("Successfully wrote telemetry cache to disk");
  } catch (err: any) {
    logger.debug(`Failed to write telemetry cache: ${err.message}`);
  }
}
