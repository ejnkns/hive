/** @private — only imported by worker-supervisor.ts */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type GitResult = {
  ok: boolean;
  message: string;
};

export function createWorktree(repoPath: string, cardId: string): GitResult {
  const worktreeDir = join(repoPath, ".worktrees", cardId);

  if (existsSync(worktreeDir)) {
    return { ok: true, message: "Worktree already exists" };
  }

  try {
    const worktreesDir = join(repoPath, ".worktrees");
    mkdirSync(worktreesDir, { recursive: true });

    execSync(`git worktree add --detach "${worktreeDir}"`, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return { ok: true, message: `Worktree created at ${worktreeDir}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to create worktree",
    };
  }
}

export function createBranch(
  worktreePath: string,
  branchName: string
): GitResult {
  try {
    if (branchExistsInWorktree(worktreePath, branchName)) {
      execSync(`git checkout "${branchName}"`, {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
      return { ok: true, message: `Checked out existing branch ${branchName}` };
    }

    execSync(`git checkout -b "${branchName}"`, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { ok: true, message: `Branch ${branchName} created` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to create branch",
    };
  }
}

function branchExistsInWorktree(
  worktreePath: string,
  branchName: string
): boolean {
  try {
    execSync(`git show-ref --verify --quiet "refs/heads/${branchName}"`, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

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

export function getCurrentBranch(worktreePath: string): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    return branch.trim();
  } catch {
    return "unknown";
  }
}

export function getWorktreePath(repoPath: string, cardId: string): string {
  return join(repoPath, ".worktrees", cardId);
}

export function removeWorktree(repoPath: string, cardId: string): GitResult {
  const worktreeDir = join(repoPath, ".worktrees", cardId);

  if (!existsSync(worktreeDir)) {
    return { ok: true, message: "Worktree does not exist" };
  }

  try {
    execSync(`git worktree remove "${worktreeDir}" --force`, {
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
