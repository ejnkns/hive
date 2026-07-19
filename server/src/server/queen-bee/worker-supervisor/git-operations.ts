/** @private — only imported by worker-supervisor.ts */

import { execSync } from "node:child_process";

export type { PreparedWorktree } from "./git-operations/prepare-worktree";
export { prepareWorktree } from "./git-operations/prepare-worktree";

export function getDiff(worktreePath: string, baseBranch: string): string {
  try {
    return execSync(`git diff "${baseBranch}"...HEAD`, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

export function getStatus(worktreePath: string): string {
  try {
    return (
      execSync("git status --short", {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 5_000,
      }).trim() || "Working tree clean"
    );
  } catch {
    return "Unable to read git status";
  }
}
