/** @public */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

export type GitResult = {
  ok: boolean;
  message: string;
};

export function removeWorktree(
  repoPath: string,
  worktreePath: string
): GitResult {
  const worktreesDirectory = resolve(repoPath, ".worktrees");
  const resolvedWorktree = resolve(worktreePath);
  const relativePath = relative(worktreesDirectory, resolvedWorktree);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.includes("/../")
  ) {
    return { ok: false, message: "Refusing to remove an unsafe worktree path" };
  }

  if (!existsSync(resolvedWorktree)) {
    return { ok: true, message: "Worktree does not exist" };
  }

  try {
    execFileSync("git", ["worktree", "remove", resolvedWorktree, "--force"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { ok: true, message: "Worktree removed" };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Failed to remove worktree",
    };
  }
}
