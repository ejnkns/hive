/** @private — only imported by create-project-store.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "shared/hive-dir";
import type { ProjectRegistry } from "../create-project-store";

const REGISTRY_PATH = join(HIVE_DIR, "project-registry.json");

export function loadProjectRegistry(): ProjectRegistry {
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { projects: {} };
    const projects = parsed.projects;

    if (!isRecord(projects)) {
      return { projects: {} };
    }

    const valid: ProjectRegistry["projects"] = {};
    for (const [id, entry] of Object.entries(projects)) {
      if (isRecord(entry) && typeof entry.path === "string") {
        valid[id] = {
          path: entry.path,
          ...(typeof entry.name === "string" ? { name: entry.name } : {}),
          ...(typeof entry.createdAt === "string"
            ? { createdAt: entry.createdAt }
            : {}),
          ...(typeof entry.systemPrompt === "string"
            ? { systemPrompt: entry.systemPrompt }
            : {}),
          ...(typeof entry.codingGuidelines === "string"
            ? { codingGuidelines: entry.codingGuidelines }
            : {}),
          ...(typeof entry.targetBranch === "string"
            ? { targetBranch: entry.targetBranch }
            : {}),
          ...(typeof entry.maxConcurrentWorkers === "number"
            ? { maxConcurrentWorkers: entry.maxConcurrentWorkers }
            : {}),
        };
      }
    }

    return { projects: valid };
  } catch {
    return { projects: {} };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRegistryPath(): string {
  return REGISTRY_PATH;
}
