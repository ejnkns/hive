/** @private — only imported by worker-supervisor.ts */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type GitResult = {
  ok: boolean;
  message: string;
};

export type PreparedWorktree =
  | { ok: true; message: string; path: string; baseCommit: string }
  | { ok: false; message: string };

export function prepareWorktree(
  repoPath: string,
  cardId: string
): PreparedWorktree {
  const worktreeDir = join(repoPath, ".worktrees", cardId);
  const branchName = `qb/${cardId}`;

  try {
    const worktreesDir = join(repoPath, ".worktrees");
    mkdirSync(worktreesDir, { recursive: true });
    const branchExists = hasBranch(repoPath, branchName);

    if (existsSync(worktreeDir)) {
      const currentBranch = getCurrentBranch(worktreeDir);
      if (currentBranch !== branchName) {
        return {
          ok: false,
          message: `Existing worktree is on '${currentBranch}', expected '${branchName}'`,
        };
      }
      const baseCommit = getMergeBase(repoPath, branchName);
      if (!baseCommit) {
        return unrelatedHistory(branchName);
      }
      return {
        ok: true,
        message: `Reusing worktree at ${worktreeDir}`,
        path: worktreeDir,
        baseCommit,
      };
    }

    if (branchExists) {
      const baseCommit = getMergeBase(repoPath, branchName);
      if (!baseCommit) {
        return unrelatedHistory(branchName);
      }
      execFileSync("git", ["worktree", "add", worktreeDir, branchName], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      });
      return {
        ok: true,
        message: `Restored worktree at ${worktreeDir}`,
        path: worktreeDir,
        baseCommit,
      };
    }

    const baseCommit = getHeadCommit(repoPath);
    execFileSync(
      "git",
      ["worktree", "add", "-b", branchName, worktreeDir, "HEAD"],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      }
    );
    return {
      ok: true,
      message: `Worktree created at ${worktreeDir}`,
      path: worktreeDir,
      baseCommit,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to prepare worktree",
    };
  }
}

function hasBranch(repoPath: string, branchName: string): boolean {
  try {
    execFileSync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5_000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

function getMergeBase(repoPath: string, branchName: string): string | null {
  try {
    return execFileSync("git", ["merge-base", "HEAD", branchName], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

function unrelatedHistory(branchName: string): PreparedWorktree {
  return {
    ok: false,
    message: `Existing branch '${branchName}' has no shared history with the project HEAD`,
  };
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

function getHeadCommit(worktreePath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return "HEAD~1";
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
