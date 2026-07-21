/** @public */

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ReviewReadiness } from "shared/board-types";
import { parseMergeTreeResult } from "./integration-manager/parse-merge-tree";
import { removeWorktree } from "./worktree";

export type IntegrationRevision = {
  branchName: typeof INTEGRATION_BRANCH;
  revision: string;
};

export type IntegrationStatus = IntegrationRevision & {
  targetBranch: string;
  targetRevision: string;
  state: "integrated" | "ready" | "diverged";
  ahead: number;
  behind: number;
  canIntegrate: boolean;
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
  status(repoPath: string, targetBranch: string): IntegrationStatus;
  integrate(repoPath: string, targetBranch: string): IntegrationStatus;
  reviewReadiness(input: AcceptWorkInput): ReviewReadiness;
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
    status: integrationStatus,
    integrate: integrateTargetBranch,
    reviewReadiness,
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

const INTEGRATION_BRANCH = "hive-main";

function integrationStatus(
  repoPath: string,
  targetBranch: string
): IntegrationStatus {
  const integration = ensureIntegrationBranch(repoPath);
  assertTargetBranch(repoPath, targetBranch);
  const targetRevision = git(repoPath, ["rev-parse", targetBranch]);
  const ahead = Number(
    git(repoPath, [
      "rev-list",
      "--count",
      `${targetBranch}..${INTEGRATION_BRANCH}`,
    ])
  );
  const behind = Number(
    git(repoPath, [
      "rev-list",
      "--count",
      `${INTEGRATION_BRANCH}..${targetBranch}`,
    ])
  );
  const integrationIsInTarget = gitSucceeds(repoPath, [
    "merge-base",
    "--is-ancestor",
    INTEGRATION_BRANCH,
    targetBranch,
  ]);
  const targetIsInIntegration = gitSucceeds(repoPath, [
    "merge-base",
    "--is-ancestor",
    targetBranch,
    INTEGRATION_BRANCH,
  ]);
  const state = integrationIsInTarget
    ? "integrated"
    : targetIsInIntegration
      ? "ready"
      : "diverged";
  return {
    ...integration,
    targetBranch,
    targetRevision,
    state,
    ahead,
    behind,
    canIntegrate: state === "ready" && ahead > 0,
  };
}

function integrateTargetBranch(
  repoPath: string,
  targetBranch: string
): IntegrationStatus {
  const before = integrationStatus(repoPath, targetBranch);
  if (before.state === "integrated") return before;
  if (before.state === "diverged") {
    throw new Error(
      `${targetBranch} and ${INTEGRATION_BRANCH} have diverged; reconcile them explicitly before integrating`
    );
  }

  const checkedOutPath = branchWorktreePath(repoPath, targetBranch);
  if (checkedOutPath) {
    if (git(checkedOutPath, ["status", "--porcelain"])) {
      throw new Error(
        `${targetBranch} is checked out with uncommitted changes`
      );
    }
    git(checkedOutPath, ["merge", "--ff-only", INTEGRATION_BRANCH]);
  } else {
    git(repoPath, [
      "update-ref",
      `refs/heads/${targetBranch}`,
      before.revision,
      before.targetRevision,
    ]);
  }
  return integrationStatus(repoPath, targetBranch);
}

function assertTargetBranch(repoPath: string, targetBranch: string): void {
  if (!targetBranch || targetBranch === INTEGRATION_BRANCH) {
    throw new Error("A target branch other than hive-main is required");
  }
  if (!hasBranch(repoPath, targetBranch)) {
    throw new Error(`Target branch '${targetBranch}' does not exist`);
  }
}

function branchWorktreePath(
  repoPath: string,
  branchName: string
): string | null {
  const records = git(repoPath, ["worktree", "list", "--porcelain"])
    .split("\n\n")
    .map((record) => record.split("\n"));
  const branchRef = `branch refs/heads/${branchName}`;
  for (const record of records) {
    if (!record.includes(branchRef)) continue;
    const worktree = record.find((line) => line.startsWith("worktree "));
    if (worktree) return worktree.slice("worktree ".length);
  }
  return null;
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
    git(integrationWorktree.path, ["add", "-f", "--", ".hive/requirements.md"]);
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
  const readiness = reviewReadiness(input);
  if (!readiness.canAccept) throw new Error(readiness.message);
}

function reviewReadiness(input: AcceptWorkInput): ReviewReadiness {
  const integrationRevision = ensureIntegrationBranch(input.repoPath).revision;
  const branchHead = git(input.repoPath, ["rev-parse", input.branchName]);
  const revisionState = {
    integrationRevision,
    reviewedIntegrationRevision: input.reviewedIntegrationRevision,
    branchHead,
    reviewedHead: input.reviewedHead,
    conflictingFiles: [],
  };
  if (branchHead !== input.reviewedHead) {
    return {
      ...revisionState,
      state: "branch_changed",
      canAccept: false,
      canRefreshReview: false,
      message:
        "Worker branch changed since review; request changes before continuing",
    };
  }
  if (
    existsSync(input.worktreePath) &&
    git(input.worktreePath, ["status", "--porcelain"])
  ) {
    return {
      ...revisionState,
      state: "dirty",
      canAccept: false,
      canRefreshReview: false,
      message: "Worker worktree has uncommitted changes",
    };
  }
  if (integrationRevision === input.reviewedIntegrationRevision) {
    return {
      ...revisionState,
      state: "current",
      canAccept: true,
      canRefreshReview: false,
      message: "Reviewed work is current with hive-main",
    };
  }

  const mergeResult = analyzeMerge(input.repoPath, input.branchName);
  if (mergeResult.state === "mergeable") {
    return {
      ...revisionState,
      state: "stale",
      canAccept: false,
      canRefreshReview: true,
      message:
        "hive-main changed since review; refresh review against the latest accepted work",
    };
  }
  if (mergeResult.state === "error") {
    return {
      ...revisionState,
      state: "error",
      canAccept: false,
      canRefreshReview: false,
      message: `Could not determine review readiness: ${mergeResult.message}`,
    };
  }
  return {
    ...revisionState,
    state: "conflicted",
    canAccept: false,
    canRefreshReview: false,
    conflictingFiles: mergeResult.files,
    message:
      mergeResult.files.length > 0
        ? `Reviewed work conflicts with hive-main in: ${mergeResult.files.join(", ")}`
        : "Reviewed work conflicts with the latest hive-main",
  };
}

function analyzeMerge(repoPath: string, branchName: string) {
  const result = spawnSync(
    "git",
    ["merge-tree", "--write-tree", "--name-only", "hive-main", branchName],
    {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return parseMergeTreeResult({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error ? { error: result.error } : {}),
    signal: result.signal,
  });
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
