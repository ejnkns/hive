/** @private — only imported by runners.ts */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type WorktreeResult = {
  branchName: string;
  worktreePath: string;
  baseCommit: string;
};

export type PrepareWorktreeParams = {
  repoPath: string;
  workspacesBasePath: string;
  projectId: string;
  cardId: string;
  attempt: number;
};

export function prepareWorktree(
  params: PrepareWorktreeParams
):
  | { ok: true; path: string; branchName: string; baseCommit: string }
  | { ok: false; message: string } {
  const { repoPath, workspacesBasePath, projectId, cardId, attempt } = params;

  const branchName = `hive/${cardId}/attempt-${attempt}`;
  const worktreePath = join(
    workspacesBasePath,
    projectId,
    cardId,
    `attempt-${attempt}`
  );

  try {
    const baseCommit = execFileSync("git", ["rev-parse", "hive-main"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    if (!existsSync(worktreePath)) {
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["worktree", "add", worktreePath, "hive-main"], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 15_000,
      });
    }

    try {
      execFileSync("git", ["checkout", "hive-main"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch {
      // worktree may already be on hive-main
    }

    const existing = execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`],
      {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 5_000,
      }
    ).trim();
    if (!existing) {
      execFileSync("git", ["checkout", "-b", branchName], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } else {
      execFileSync("git", ["checkout", branchName], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    }

    return { ok: true, path: worktreePath, branchName, baseCommit };
  } catch (err: unknown) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to prepare worktree",
    };
  }
}
