/** @public */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function readRequirements(repoPath: string): string {
  const path = join(repoPath, ".hive", "requirements.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function requirementsRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function writeRequirements(repoPath: string, content: string): void {
  mkdirSync(join(repoPath, ".hive"), { recursive: true });
  const path = join(repoPath, ".hive", "requirements.md");
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, content, "utf-8");
  renameSync(temporaryPath, path);
}
