/** @public */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { removeWorktree } from "./worker-supervisor/git-operations";

const INTEGRATION_BRANCH = "hive-main";

export type IntegrationRevision = {
  branchName: typeof INTEGRATION_BRANCH;
  revision: string;
};

export type AcceptWorkInput = {
  repoPath: string;
  cardId: string;
  branchName: string;
  worktreePath: string;
  reviewedHead: string;
  reviewedIntegrationRevision: string;
};

export type IntegrationManager = {
  ensure(repoPath: string): IntegrationRevision;
  assertCurrent(input: AcceptWorkInput): void;
  accept(input: AcceptWorkInput): IntegrationRevision;
  discardWorktree(repoPath: string, worktreePath: string): void;
  commitPlanningSnapshot(
    repoPath: string,
    proposalId: string
  ): IntegrationRevision;
};

export function createIntegrationManager(): IntegrationManager {
  return {
    ensure: ensureIntegrationBranch,
    assertCurrent: assertReviewedWorkCurrent,
    accept: acceptWork,
    commitPlanningSnapshot,
    discardWorktree(repoPath, worktreePath) {
      if (
        existsSync(worktreePath) &&
        git(worktreePath, ["status", "--porcelain"])
      ) {
        throw new Error(
          "Worker worktree has uncommitted changes and cannot be discarded"
        );
      }
      const result = removeWorktree(repoPath, worktreePath);
      if (!result.ok) throw new Error(result.message);
    },
  };
}

function commitPlanningSnapshot(
  repoPath: string,
  proposalId: string
): IntegrationRevision {
  ensureIntegrationBranch(repoPath);
  const integrationWorktree = acquireIntegrationWorktree(repoPath);
  try {
    if (integrationWorktree.temporary) {
      copyPlanningFile(repoPath, integrationWorktree.path, "requirements.md");
      copyPlanningFile(repoPath, integrationWorktree.path, "board.json");
      copyPlanningFile(repoPath, integrationWorktree.path, "project.json");
      const sourceCards = join(repoPath, ".hive", "cards");
      if (existsSync(sourceCards)) {
        cpSync(sourceCards, join(integrationWorktree.path, ".hive", "cards"), {
          recursive: true,
        });
      }
    }
    git(integrationWorktree.path, ["add", "-A", "--", ".hive"]);
    if (
      !gitSucceeds(integrationWorktree.path, ["diff", "--cached", "--quiet"])
    ) {
      git(integrationWorktree.path, [
        "commit",
        "-m",
        `hive: apply planning proposal ${proposalId}`,
      ]);
    }
    return ensureIntegrationBranch(repoPath);
  } finally {
    if (integrationWorktree.temporary) {
      removeWorktree(repoPath, integrationWorktree.path);
    }
  }
}

function copyPlanningFile(
  repoPath: string,
  integrationWorktree: string,
  filename: string
): void {
  const source = join(repoPath, ".hive", filename);
  if (!existsSync(source)) return;
  const destinationDirectory = join(integrationWorktree, ".hive");
  mkdirSync(destinationDirectory, { recursive: true });
  cpSync(source, join(destinationDirectory, filename));
}

export function ensureIntegrationBranch(repoPath: string): IntegrationRevision {
  if (!hasBranch(repoPath, INTEGRATION_BRANCH)) {
    git(repoPath, ["branch", INTEGRATION_BRANCH, "HEAD"]);
  }
  return {
    branchName: INTEGRATION_BRANCH,
    revision: git(repoPath, ["rev-parse", INTEGRATION_BRANCH]),
  };
}

function acceptWork(input: AcceptWorkInput): IntegrationRevision {
  assertReviewedWorkCurrent(input);

  const integrationWorktree = acquireIntegrationWorktree(input.repoPath);
  try {
    git(integrationWorktree.path, [
      "merge",
      "--no-ff",
      "--no-edit",
      "-m",
      `hive: accept ${input.cardId}`,
      input.branchName,
    ]);
  } catch (error) {
    abortMerge(integrationWorktree.path);
    throw new Error(
      `Could not merge accepted work into ${INTEGRATION_BRANCH}: ${errorMessage(error)}`
    );
  } finally {
    if (integrationWorktree.temporary) {
      removeWorktree(input.repoPath, integrationWorktree.path);
    }
  }

  const cleanup = removeWorktree(input.repoPath, input.worktreePath);
  if (!cleanup.ok) throw new Error(cleanup.message);
  git(input.repoPath, ["branch", "-D", input.branchName]);
  return ensureIntegrationBranch(input.repoPath);
}

function assertReviewedWorkCurrent(input: AcceptWorkInput): void {
  const integration = ensureIntegrationBranch(input.repoPath);
  if (integration.revision !== input.reviewedIntegrationRevision) {
    throw new Error(
      "Hive integration branch changed since review; restart review before accepting"
    );
  }
  const branchHead = git(input.repoPath, ["rev-parse", input.branchName]);
  if (branchHead !== input.reviewedHead) {
    throw new Error(
      "Worker branch changed since review; restart review before accepting"
    );
  }
  if (
    existsSync(input.worktreePath) &&
    git(input.worktreePath, ["status", "--porcelain"])
  ) {
    throw new Error("Worker worktree has uncommitted changes");
  }
}

function acquireIntegrationWorktree(repoPath: string): {
  path: string;
  temporary: boolean;
} {
  if (git(repoPath, ["branch", "--show-current"]) === INTEGRATION_BRANCH) {
    if (git(repoPath, ["status", "--porcelain", "--untracked-files=no"])) {
      throw new Error(
        `${INTEGRATION_BRANCH} is checked out with uncommitted changes`
      );
    }
    return { path: repoPath, temporary: false };
  }
  const worktreesDirectory = join(repoPath, ".worktrees");
  mkdirSync(worktreesDirectory, { recursive: true });
  const worktreePath = join(
    worktreesDirectory,
    `.hive-integration-${randomUUID()}`
  );
  git(repoPath, ["worktree", "add", worktreePath, INTEGRATION_BRANCH]);
  return { path: worktreePath, temporary: true };
}

function hasBranch(repoPath: string, branchName: string): boolean {
  try {
    git(repoPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

function abortMerge(worktreePath: string): void {
  try {
    git(worktreePath, ["merge", "--abort"]);
  } catch {
    // A failed merge may stop before creating merge state.
  }
}

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitSucceeds(repoPath: string, args: string[]): boolean {
  try {
    git(repoPath, args);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown Git error";
}
