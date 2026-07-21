/** @public */

import { execFileSync } from "node:child_process";
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
  if (existsSync(path)) return readFileSync(path, "utf-8");
  try {
    return execFileSync("git", ["show", "hive-main:.hive/requirements.md"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
  } catch {
    return "";
  }
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
