/** @private — only imported by git-operations.ts */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  const worktreesDir = join(repoPath, ".worktrees");
  const worktreeDir = join(worktreesDir, cardId);
  const branchName = `qb/${cardId}`;

  try {
    mkdirSync(worktreesDir, { recursive: true });
    if (existsSync(worktreeDir)) {
      const baseCommit = compatibleBaseCommit(repoPath, branchName);
      if (getCurrentBranch(worktreeDir) !== branchName || !baseCommit) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      return prepared(
        `Reusing worktree at ${worktreeDir}`,
        worktreeDir,
        baseCommit,
        branchName
      );
    }

    if (hasBranch(repoPath, branchName)) {
      const baseCommit = compatibleBaseCommit(repoPath, branchName);
      if (!baseCommit) {
        return prepareRecoveryWorktree(repoPath, cardId, worktreesDir);
      }
      execFileSync("git", ["worktree", "add", worktreeDir, branchName], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      });
      return prepared(
        `Restored worktree at ${worktreeDir}`,
        worktreeDir,
        baseCommit,
        branchName
      );
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
    return prepared(
      `Worktree created at ${worktreeDir}`,
      worktreeDir,
      baseCommit,
      branchName
    );
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to prepare worktree",
    };
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
        return prepared(
          `Reusing recovery worktree at ${worktreeDir}`,
          worktreeDir,
          baseCommit,
          branchName
        );
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
        return prepared(
          `Restored recovery worktree at ${worktreeDir}`,
          worktreeDir,
          baseCommit,
          branchName
        );
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
    return prepared(
      `Created recovery worktree at ${worktreeDir}`,
      worktreeDir,
      baseCommit,
      branchName
    );
  }

  return {
    ok: false,
    message: `Could not allocate a recovery worktree for card '${cardId}'`,
  };
}

function compatibleBaseCommit(
  repoPath: string,
  branchName: string
): string | null {
  const baseCommit = getMergeBase(repoPath, branchName);
  return baseCommit === getHeadCommit(repoPath) ? baseCommit : null;
}

function prepared(
  message: string,
  path: string,
  baseCommit: string,
  branchName: string
): PreparedWorktree {
  return { ok: true, message, path, baseCommit, branchName };
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

function getHeadCommit(repoPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return "HEAD~1";
  }
}

function getCurrentBranch(worktreePath: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return "unknown";
  }
}
