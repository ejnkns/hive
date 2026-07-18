/** @private — only imported by worker-supervisor.ts */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type GitResult = {
  ok: boolean;
  message: string;
};

export type PreparedWorktree =
  | {
      ok: true;
      message: string;
      path: string;
      baseCommit: string;
      branchName: string;
    }
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
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      const baseCommit = getMergeBase(repoPath, branchName);
      if (!baseCommit) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      if (baseCommit !== getHeadCommit(repoPath)) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      return {
        ok: true,
        message: `Reusing worktree at ${worktreeDir}`,
        path: worktreeDir,
        baseCommit,
        branchName,
      };
    }

    if (branchExists) {
      const baseCommit = getMergeBase(repoPath, branchName);
      if (!baseCommit) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      if (baseCommit !== getHeadCommit(repoPath)) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
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
        branchName,
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
      branchName,
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

function prepareRecoveryWorktree(
  repoPath: string,
  cardId: string,
  worktreesDir: string
): PreparedWorktree {
  const baseCommit = getHeadCommit(repoPath);
  const recoveryBase = `${cardId}-recovery-${baseCommit.slice(0, 8)}`;

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `-${String(attempt + 1)}`;
    const recoveryId = `${recoveryBase}${suffix}`;
    const branchName = `qb/${recoveryId}`;
    const worktreeDir = join(worktreesDir, recoveryId);

    if (existsSync(worktreeDir)) {
      if (
        getCurrentBranch(worktreeDir) === branchName &&
        getMergeBase(repoPath, branchName) === baseCommit
      ) {
        return {
          ok: true,
          message: `Reusing recovery worktree at ${worktreeDir}`,
          path: worktreeDir,
          baseCommit,
          branchName,
        };
      }
      continue;
    }

    if (hasBranch(repoPath, branchName)) {
      if (getMergeBase(repoPath, branchName) !== baseCommit) continue;
      try {
        execFileSync("git", ["worktree", "add", worktreeDir, branchName], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 30_000,
        });
        return {
          ok: true,
          message: `Restored recovery worktree at ${worktreeDir}`,
          path: worktreeDir,
          baseCommit,
          branchName,
        };
      } catch {
        continue;
      }
    }

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
      message: `Created recovery worktree at ${worktreeDir}`,
      path: worktreeDir,
      baseCommit,
      branchName,
    };
  }

  return {
    ok: false,
    message: `Could not allocate a recovery worktree for card '${cardId}'`,
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
