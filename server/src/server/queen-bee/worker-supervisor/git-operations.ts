/** @private — only imported by worker-supervisor.ts */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

export type { PreparedWorktree } from "./git-operations/prepare-worktree";
export { prepareWorktree } from "./git-operations/prepare-worktree";

export type GitResult = {
  ok: boolean;
  message: string;
};

export function commitChanges(
  worktreePath: string,
  message: string
): GitResult {
  try {
    execSync(`git add -A`, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    });

    try {
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch {
      return { ok: true, message: "No changes to commit" };
    }

    return { ok: true, message: "Changes committed" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to commit",
    };
  }
}

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

export function createPullRequest(
  worktreePath: string,
  branchName: string,
  title: string,
  body: string
): { ok: boolean; url?: string; message?: string } {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
    if (!remote) return { ok: false, message: "No origin remote configured" };

    execFileSync("git", ["push", "origin", branchName], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 60_000,
    });
    const url = execFileSync(
      "gh",
      ["pr", "create", "--head", branchName, "--title", title, "--body", body],
      { cwd: worktreePath, encoding: "utf-8", timeout: 60_000 }
    ).trim();
    return { ok: true, url };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "PR creation failed",
    };
  }
}

export function removeWorktree(
  repoPath: string,
  worktreePath: string
): GitResult {
  const worktreesDir = resolve(repoPath, ".worktrees");
  const resolvedWorktree = resolve(worktreePath);
  const relativePath = relative(worktreesDir, resolvedWorktree);
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
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to remove worktree",
    };
  }
}
