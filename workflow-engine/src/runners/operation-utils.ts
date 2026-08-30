/** @private — only imported by runners.ts */

import { execFileSync } from "node:child_process";

import { resolveFlowRoot } from "../read-flow-settings.ts";

// Helpers for authoring deterministic operations. The engine provides these so
// operations in any flow can resolve the repo binding, run git inspection, and
// read files without reimplementing raw child_process/fs/path handling.

// Resolves the flow's bound repository/directory root from config. The server
// normalizes basePath at creation (absolute, tilde-expanded, or a hive-owned
// default), so this asserts the invariant — there is no cwd fallback.
export function resolveBasePath(flowConfig: Record<string, unknown>): string {
  return resolveFlowRoot(flowConfig);
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
