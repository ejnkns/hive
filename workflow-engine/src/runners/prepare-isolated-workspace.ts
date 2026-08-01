/** @private — only imported by runners.ts */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type IsolatedWorkspaceResult = {
  ok: boolean;
  path?: string;
  branchName?: string;
  baseCommit?: string;
  message?: string;
};

// basePath is optional: with a bound repo the workspace is a git worktree on a
// feature branch; without one it is a plain sandbox directory. Both use the
// same directory layout under workspacesBasePath.
export type PrepareIsolatedWorkspaceParams = {
  basePath?: string;
  workspacesBasePath: string;
  projectId: string;
  cardId: string;
  attempt: number;
};

export function prepareIsolatedWorkspace(
  params: PrepareIsolatedWorkspaceParams
): IsolatedWorkspaceResult {
  const { basePath, workspacesBasePath, projectId, cardId, attempt } = params;

  const workspacePath = join(
    workspacesBasePath,
    projectId,
    cardId,
    `attempt-${attempt}`
  );

  // No repo bound — plain sandboxed workspace. Nothing to branch or check out.
  if (!basePath) {
    try {
      mkdirSync(workspacePath, { recursive: true });
      return { ok: true, path: workspacePath };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "Failed to prepare workspace",
      };
    }
  }

  try {
    const branchName = `hive/${cardId}/attempt-${attempt}`;
    const baseCommit = execFileSync("git", ["rev-parse", "hive-main"], {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
      execFileSync("git", ["worktree", "add", workspacePath, "hive-main"], {
        cwd: basePath,
        encoding: "utf-8",
        timeout: 15_000,
      });
    }

    try {
      execFileSync("git", ["checkout", "hive-main"], {
        cwd: workspacePath,
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
        cwd: workspacePath,
        encoding: "utf-8",
        timeout: 5_000,
      }
    ).trim();
    if (!existing) {
      execFileSync("git", ["checkout", "-b", branchName], {
        cwd: workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } else {
      execFileSync("git", ["checkout", branchName], {
        cwd: workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    }

    return { ok: true, path: workspacePath, branchName, baseCommit };
  } catch (err: unknown) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to prepare worktree",
    };
  }
}
