/** @private — only imported by runners.ts */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gitSucceeds, runGit } from "./git-command";

export type IsolatedWorkspaceResult = {
  ok: boolean;
  path?: string;
  branchName?: string;
  baseCommit?: string;
  message?: string;
};

// Discards an abandoned isolated workspace (the engine's side of the
// newAttempt action flag). With a bound repo the workspace is a git worktree
// and is removed via the main repo (a worktree cannot remove itself); without
// one it is a plain sandbox directory created by prepare_worktree and is
// removed directly. Best-effort — a stale or already-removed path must never
// fail the action that starts the new attempt.
export function discardIsolatedWorkspace(
  workspacePath: string,
  basePath?: string
): void {
  if (typeof basePath === "string" && basePath !== "") {
    gitSucceeds(basePath, ["worktree", "remove", workspacePath, "--force"]);
    return;
  }
  try {
    rmSync(workspacePath, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
export type PrepareIsolatedWorkspaceParams = {
  basePath?: string;
  workspacesBasePath: string;
  projectId: string;
  cardId: string;
  attempt: number;
  // Required when a repo is bound; read from flow config by the caller. No
  // engine defaults — a git-capable flow must declare them.
  integrationBranch?: string;
  branchPrefix?: string;
};

export function prepareIsolatedWorkspace(
  params: PrepareIsolatedWorkspaceParams
): IsolatedWorkspaceResult {
  const {
    basePath,
    workspacesBasePath,
    projectId,
    cardId,
    attempt,
    integrationBranch,
    branchPrefix,
  } = params;

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

  if (!integrationBranch || !branchPrefix) {
    return {
      ok: false,
      message:
        "Flow config integrationBranch and branchPrefix are required for a repo-bound workspace",
    };
  }

  try {
    const branchName = `${branchPrefix}${cardId}/attempt-${attempt}`;
    const baseCommit = runGit(
      basePath,
      ["rev-parse", integrationBranch],
      10_000
    );

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
      runGit(
        basePath,
        ["worktree", "add", workspacePath, integrationBranch],
        15_000
      );
    }

    try {
      runGit(workspacePath, ["checkout", integrationBranch], 10_000);
    } catch {
      // worktree may already be on the integration branch
    }

    const branchExists = gitSucceeds(workspacePath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    if (!branchExists) {
      runGit(workspacePath, ["checkout", "-b", branchName], 10_000);
    } else {
      runGit(workspacePath, ["checkout", branchName], 10_000);
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
