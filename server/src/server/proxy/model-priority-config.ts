import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { logger } from "shared/logger";
import type { ModelPriority } from "shared/model-priority-types";

export type { ModelPriority };

let modelPriority: ModelPriority | null = null;

function configPath(): string {
  const dir = process.env.HIVE_DATA_DIR
    ? resolve(process.env.HIVE_DATA_DIR)
    : join(homedir(), ".hive");
  return join(dir, "model-priority.json");
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function saveModelPriority(config: ModelPriority): void {
  const path = configPath();
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  modelPriority = config;
  logger.info(
    `model priority saved: modelPriority=[${config.modelPriority.join(", ")}]${config.providerPriority ? ` providerPriority=[${config.providerPriority.join(", ")}]` : ""}`
  );
}

export function loadModelPriority(): void {
  try {
    const path = configPath();
    if (!existsSync(path)) {
      modelPriority = null;
      return;
    }

    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      console.warn("model-priority.json: must be a JSON object, ignoring");
      modelPriority = null;
      return;
    }

    const config = parsed as Record<string, unknown>;

    if (!Array.isArray(config.modelPriority)) {
      console.warn(
        "model-priority.json: modelPriority must be a non-empty array, ignoring"
      );
      modelPriority = null;
      return;
    }

    if (config.modelPriority.length === 0) {
      console.warn("model-priority.json: modelPriority is empty, ignoring");
      modelPriority = null;
      return;
    }

    if (
      config.providerPriority !== undefined &&
      !Array.isArray(config.providerPriority)
    ) {
      console.warn(
        "model-priority.json: providerPriority must be an array if present, ignoring"
      );
      modelPriority = null;
      return;
    }

    modelPriority = {
      modelPriority: config.modelPriority as string[],
      providerPriority: config.providerPriority as string[] | undefined,
    };

    logger.info(
      `model priority loaded: modelPriority=[${modelPriority.modelPriority.join(", ")}]${modelPriority.providerPriority ? ` providerPriority=[${modelPriority.providerPriority.join(", ")}]` : ""}`
    );
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      modelPriority = null;
      return;
    }
    console.warn(
      "model-priority.json: failed to parse, ignoring:",
      (e as Error).message
    );
    modelPriority = null;
  }
}

export function getModelPriority(): ModelPriority | null {
  return modelPriority;
}
