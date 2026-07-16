/** @private — only imported by create-project-store.ts */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProjectRegistry } from "../create-project-store";
import { getRegistryPath } from "./load-project-registry";

export function writeProjectRegistry(registry: ProjectRegistry): void {
  const registryPath = getRegistryPath();
  const dir = dirname(registryPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${registryPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  renameSync(tmpPath, registryPath);
}
