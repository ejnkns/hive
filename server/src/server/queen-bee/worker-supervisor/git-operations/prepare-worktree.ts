/** @private — only imported by git-operations.ts */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureIntegrationBranch } from "../../integration-manager";

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
  cardId: string,
  attempt = 1
): PreparedWorktree {
  const worktreesDir = join(repoPath, ".worktrees");
  const worktreeDir = join(
    worktreesDir,
    attempt === 1 ? cardId : `${cardId}-attempt-${String(attempt)}`
  );
  const branchName = `hive/${cardId}/attempt-${String(attempt)}`;
  const integration = ensureIntegrationBranch(repoPath);

  try {
    mkdirSync(worktreesDir, { recursive: true });
    if (existsSync(worktreeDir)) {
      const currentBranch = getCurrentBranch(worktreeDir);
      const legacyBranch = `qb/${cardId}`;
      const reusableBranch =
        currentBranch === branchName ||
        (attempt === 1 && currentBranch === legacyBranch);
      const baseCommit = reusableBranch
        ? compatibleBaseCommit(repoPath, currentBranch, integration.revision)
        : null;
      if (!baseCommit) {
        return prepareRecoveryWorktree(
          repoPath,
          cardId,
          worktreesDir,
          attempt,
          integration.revision
        );
      }
      return prepared(
        `Reusing worktree at ${worktreeDir}`,
        worktreeDir,
        baseCommit,
        currentBranch
      );
    }

    if (hasBranch(repoPath, branchName)) {
      const baseCommit = compatibleBaseCommit(
        repoPath,
        branchName,
        integration.revision
      );
      if (!baseCommit) {
        return prepareRecoveryWorktree(
          repoPath,
          cardId,
          worktreesDir,
          attempt,
          integration.revision
        );
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

    const legacyBranch = `qb/${cardId}`;
    if (attempt === 1 && hasBranch(repoPath, legacyBranch)) {
      const baseCommit = compatibleBaseCommit(
        repoPath,
        legacyBranch,
        integration.revision
      );
      if (baseCommit) {
        execFileSync("git", ["worktree", "add", worktreeDir, legacyBranch], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 30_000,
        });
        return prepared(
          `Restored legacy worktree at ${worktreeDir}`,
          worktreeDir,
          baseCommit,
          legacyBranch
        );
      }
    }

    execFileSync(
      "git",
      [
        "worktree",
        "add",
        "-b",
        branchName,
        worktreeDir,
        integration.branchName,
      ],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      }
    );
    return prepared(
      `Worktree created at ${worktreeDir}`,
      worktreeDir,
      integration.revision,
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
  worktreesDir: string,
  attempt: number,
  integrationRevision: string
): PreparedWorktree {
  const recoveryBase = `${cardId}-attempt-${String(attempt)}-recovery-${integrationRevision.slice(0, 8)}`;

  for (let allocation = 0; allocation < 100; allocation++) {
    const suffix = allocation === 0 ? "" : `-${String(allocation + 1)}`;
    const recoveryId = `${recoveryBase}${suffix}`;
    const branchName = `hive/${cardId}/attempt-${String(attempt)}-recovery${suffix}`;
    const worktreeDir = join(worktreesDir, recoveryId);

    if (existsSync(worktreeDir)) {
      if (getCurrentBranch(worktreeDir) === branchName) {
        return prepared(
          `Reusing recovery worktree at ${worktreeDir}`,
          worktreeDir,
          integrationRevision,
          branchName
        );
      }
      continue;
    }

    if (hasBranch(repoPath, branchName)) {
      try {
        execFileSync("git", ["worktree", "add", worktreeDir, branchName], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 30_000,
        });
        return prepared(
          `Restored recovery worktree at ${worktreeDir}`,
          worktreeDir,
          integrationRevision,
          branchName
        );
      } catch {
        continue;
      }
    }

    execFileSync(
      "git",
      ["worktree", "add", "-b", branchName, worktreeDir, "hive-main"],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      }
    );
    return prepared(
      `Created recovery worktree at ${worktreeDir}`,
      worktreeDir,
      integrationRevision,
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
  branchName: string,
  integrationRevision: string
): string | null {
  const baseCommit = getMergeBase(repoPath, "hive-main", branchName);
  return baseCommit === integrationRevision ? baseCommit : null;
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

function getMergeBase(
  repoPath: string,
  leftBranch: string,
  rightBranch: string
): string | null {
  try {
    return execFileSync("git", ["merge-base", leftBranch, rightBranch], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
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
