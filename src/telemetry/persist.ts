import { homedir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import type { RequestMetric } from "./request-metric"
import type { DerivedMetrics } from "./derived-metrics"
import { logger } from "../hive/shared/logger"

export type ModelScore = {
  provider: string
  model: string
  score: number
  derived: DerivedMetrics
  updatedAt: number
}

export type TelemetryCache = {
  metrics: RequestMetric[]
  scores: ModelScore[]
}

const HIVE_DIR = join(homedir(), ".hive")
const TELEMETRY_PATH = join(HIVE_DIR, "telemetry-cache.json")

async function ensureHiveDir(): Promise<void> {
  try {
    await fs.mkdir(HIVE_DIR, { recursive: true })
  } catch (err: any) {
    logger.debug(`Failed to create telemetry directory: ${err.message}`)
  }
}

export async function loadCache(): Promise<TelemetryCache> {
  try {
    const data = await fs.readFile(TELEMETRY_PATH, "utf-8")
    const parsed = JSON.parse(data)
    if (parsed && Array.isArray(parsed.metrics) && Array.isArray(parsed.scores)) {
      return parsed
    }
  } catch {
    // file doesn't exist or invalid — start fresh
  }
  return { metrics: [], scores: [] }
}

export async function saveCache(cache: TelemetryCache): Promise<void> {
  try {
    await ensureHiveDir()
    await fs.writeFile(TELEMETRY_PATH, JSON.stringify(cache, null, 2), "utf-8")
  } catch (err: any) {
    logger.debug(`Failed to write telemetry cache: ${err.message}`)
  }
}
