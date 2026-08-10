/** @private — only imported by runners.ts */

import { execFileSync } from "node:child_process";

import { join } from "node:path";

// Helpers for authoring deterministic operations. The engine provides these so
// operations in any flow can resolve the repo binding, run git inspection, and
// read files without reimplementing raw child_process/fs/path handling.

// Resolves the flow's bound repository/directory root from config, treating a
// relative path as relative to the process cwd. Throws when no repo is bound.
export function resolveBasePath(flowConfig: Record<string, unknown>): string {
  const raw = flowConfig.basePath;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Flow config basePath is not set");
  }
  return raw.startsWith("/") ? raw : join(process.cwd(), raw);
}

// Runs a git command in the flow's repo, returning "" on failure. Operations
// use this for read-only inspection; they never mutate git themselves.
export function gitOptional(basePath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}
