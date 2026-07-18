/** @private — only imported by create-project-store.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "shared/hive-dir";
import type { ProjectRegistry } from "../create-project-store";

const REGISTRY_PATH = join(HIVE_DIR, "project-registry.json");

export function loadProjectRegistry(): ProjectRegistry {
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projects = parsed.projects as
      | Record<string, { path: string }>
      | undefined;

    if (!projects || typeof projects !== "object") {
      return { projects: {} };
    }

    const valid: Record<string, { path: string }> = {};
    for (const [id, entry] of Object.entries(projects)) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).path === "string"
      ) {
        valid[id] = { path: (entry as { path: string }).path };
      }
    }

    return { projects: valid };
  } catch {
    return { projects: {} };
  }
}

export function getRegistryPath(): string {
  return REGISTRY_PATH;
}
