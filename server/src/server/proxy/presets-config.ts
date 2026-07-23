import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { logger } from "shared/logger";
import type { PresetsConfig } from "shared/presets-types";

export type { PresetsConfig };

let presetsConfig: PresetsConfig | null = null;

function presetsPath(): string {
  const dir = process.env.HIVE_DATA_DIR
    ? resolve(process.env.HIVE_DATA_DIR)
    : join(homedir(), ".hive");
  return join(dir, "presets.json");
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function savePresetsConfig(config: PresetsConfig): void {
  const path = presetsPath();
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  presetsConfig = config;
  logger.info(
    `presets saved: modelPriority=[${config.modelPriority.join(", ")}]${config.providerPriority ? ` providerPriority=[${config.providerPriority.join(", ")}]` : ""}`
  );
}

export function loadPresetsConfig(): void {
  try {
    const path = presetsPath();
    if (!existsSync(path)) {
      presetsConfig = null;
      return;
    }

    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      console.warn("presets.json: must be a JSON object, ignoring");
      presetsConfig = null;
      return;
    }

    const config = parsed as Record<string, unknown>;

    if (!Array.isArray(config.modelPriority)) {
      console.warn(
        "presets.json: modelPriority must be a non-empty array, ignoring"
      );
      presetsConfig = null;
      return;
    }

    if (config.modelPriority.length === 0) {
      console.warn("presets.json: modelPriority is empty, ignoring");
      presetsConfig = null;
      return;
    }

    if (
      config.providerPriority !== undefined &&
      !Array.isArray(config.providerPriority)
    ) {
      console.warn(
        "presets.json: providerPriority must be an array if present, ignoring"
      );
      presetsConfig = null;
      return;
    }

    presetsConfig = {
      modelPriority: config.modelPriority as string[],
      providerPriority: config.providerPriority as string[] | undefined,
    };

    logger.info(
      `presets loaded: modelPriority=[${presetsConfig.modelPriority.join(", ")}]${presetsConfig.providerPriority ? ` providerPriority=[${presetsConfig.providerPriority.join(", ")}]` : ""}`
    );
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      presetsConfig = null;
      return;
    }
    console.warn(
      "presets.json: failed to parse, ignoring:",
      (e as Error).message
    );
    presetsConfig = null;
  }
}

export function getPresetsConfig(): PresetsConfig | null {
  return presetsConfig;
}
