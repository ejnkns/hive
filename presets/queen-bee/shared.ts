/** @public — helpers shared by queen-bee operations. Import from here, not from workflow folders. */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { OperationContext } from "workflow-engine/runners";

export type OperationResult = Record<string, unknown>;

// Resolves the flow's bound repository/directory root from config, treating a
// relative path as relative to the process cwd.
export function resolveBasePath(ctx: OperationContext): string {
  const raw = ctx.flowConfig().basePath;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Flow config basePath is not set");
  }
  return raw.startsWith("/") ? raw : join(process.cwd(), raw);
}

// Runs a git command, returning "" on failure. Ops use this for read-only
// inspection; they never write files or mutate git themselves.
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
