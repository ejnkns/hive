/** @public */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "./board-store";
import { readRequirements, requirementsRevision } from "./requirements-store";
import type { ReviewPackage } from "./reviewer";
import type { WorkerCompletion } from "./worker-completion";
import { removeWorktree } from "./worktree";

export type ReviewWorkspace = {
  path: string;
  release(): void;
};

export type ReviewRevisionOverrides = {
  workerHeadCommit?: string;
  integrationCommit?: string;
  reviewReference?: string;
};

export function buildReviewPackage(
  card: Card,
  repoPath: string,
  worktreePath: string,
  baseCommit: string,
  completion: WorkerCompletion,
  revisionOverrides: ReviewRevisionOverrides = {}
): ReviewPackage {
  const requirementsContent = readRequirements(repoPath);
  const reviewCommit = git(worktreePath, ["rev-parse", "HEAD"]);
  const headCommit = revisionOverrides.workerHeadCommit ?? reviewCommit;
  const reviewData: Omit<ReviewPackage, "id"> = {
    card: {
      id: card.id,
      title: card.title,
      description: card.description,
      acceptanceCriteria: card.acceptanceCriteria,
      requirementRefs: card.requirementRefs ?? [],
    },
    requirements: {
      revision: requirementsRevision(requirementsContent),
      content: requirementsContent,
    },
    revisions: {
      baseCommit,
      headCommit,
      reviewCommit,
      ...(revisionOverrides.reviewReference
        ? { reviewReference: revisionOverrides.reviewReference }
        : {}),
      integrationCommit:
        revisionOverrides.integrationCommit ??
        git(repoPath, ["rev-parse", "hive-main"]),
      cardRevision: digest({
        title: card.title,
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
        relevantFiles: card.relevantFiles,
        dependencies: card.dependencies,
        requirementRefs: card.requirementRefs ?? [],
      }),
    },
    commits: commitList(repoPath, baseCommit, headCommit),
    changedFiles: gitLines(worktreePath, [
      "diff",
      "--name-only",
      `${baseCommit}...${reviewCommit}`,
    ]),
    diff: git(worktreePath, [
      "diff",
      "--no-ext-diff",
      `${baseCommit}...${reviewCommit}`,
    ]),
    diffStat: git(worktreePath, [
      "diff",
      "--stat",
      `${baseCommit}...${reviewCommit}`,
    ]),
    verification: {
      commands: completion.verificationEvidence,
      ...(completion.verificationNotRunReason
        ? { notRunReason: completion.verificationNotRunReason }
        : {}),
    },
    ...(completion.noChangeRationale
      ? { noChangeRationale: completion.noChangeRationale }
      : {}),
  };
  return { id: digest(reviewData), ...reviewData };
}

export function buildRefreshedReviewPackage(
  card: Card,
  repoPath: string,
  workerWorktreePath: string,
  integrationCommit: string,
  previousPackage: ReviewPackage
): { reviewPackage: ReviewPackage; workspace: ReviewWorkspace } {
  const workerHeadCommit = git(workerWorktreePath, ["rev-parse", "HEAD"]);
  const mergedTree = git(repoPath, [
    "merge-tree",
    "--write-tree",
    integrationCommit,
    workerHeadCommit,
  ]).split("\n")[0];
  if (!mergedTree) throw new Error("Git did not produce a merged review tree");
  const reviewAnchor = createReviewCommit(
    repoPath,
    mergedTree,
    integrationCommit,
    workerHeadCommit,
    card.id
  );
  const workspace = acquireDetachedReviewWorkspace(
    repoPath,
    reviewAnchor.commit
  );
  try {
    return {
      reviewPackage: buildReviewPackage(
        card,
        repoPath,
        workspace.path,
        integrationCommit,
        workerCompletionFrom(previousPackage),
        {
          workerHeadCommit,
          integrationCommit,
          reviewReference: reviewAnchor.reference,
        }
      ),
      workspace,
    };
  } catch (error) {
    workspace.release();
    git(repoPath, ["update-ref", "-d", reviewAnchor.reference]);
    throw error;
  }
}

export function acquireReviewWorkspace(
  repoPath: string,
  workerWorktreePath: string,
  reviewPackage: ReviewPackage
): ReviewWorkspace {
  if (
    reviewPackage.revisions.reviewCommit === reviewPackage.revisions.headCommit
  ) {
    return { path: workerWorktreePath, release() {} };
  }
  return acquireDetachedReviewWorkspace(
    repoPath,
    reviewPackage.revisions.reviewCommit
  );
}

export function releaseReviewReference(
  repoPath: string,
  reviewPackage: ReviewPackage
): void {
  const reference = reviewPackage.revisions.reviewReference;
  if (!reference) return;
  git(repoPath, ["update-ref", "-d", reference]);
}

export function workerCompletionFrom(
  reviewPackage: ReviewPackage
): WorkerCompletion {
  return {
    outcome: reviewPackage.noChangeRationale
      ? "already_satisfied"
      : "implemented",
    verificationCallIds: reviewPackage.verification.commands.map(
      (command) => command.callId
    ),
    verificationEvidence: reviewPackage.verification.commands,
    ...(reviewPackage.verification.notRunReason
      ? { verificationNotRunReason: reviewPackage.verification.notRunReason }
      : {}),
    ...(reviewPackage.noChangeRationale
      ? { noChangeRationale: reviewPackage.noChangeRationale }
      : {}),
  };
}

function commitList(
  repoPath: string,
  baseCommit: string,
  headCommit: string
): Array<{ sha: string; subject: string }> {
  return gitLines(repoPath, [
    "log",
    "--format=%H%x09%s",
    `${baseCommit}..${headCommit}`,
  ]).map((line) => {
    const separator = line.indexOf("\t");
    return {
      sha: line.slice(0, separator),
      subject: line.slice(separator + 1),
    };
  });
}

function createReviewCommit(
  repoPath: string,
  tree: string,
  integrationCommit: string,
  workerHeadCommit: string,
  cardId: string
): { commit: string; reference: string } {
  const identity = {
    GIT_AUTHOR_NAME: "Hive Supervisor",
    GIT_AUTHOR_EMAIL: "supervisor@hive.local",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Hive Supervisor",
    GIT_COMMITTER_EMAIL: "supervisor@hive.local",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const commit = execFileSync(
    "git",
    [
      "commit-tree",
      tree,
      "-p",
      integrationCommit,
      "-p",
      workerHeadCommit,
      "-m",
      `hive: review combined state for ${cardId}`,
    ],
    {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, ...identity },
    }
  ).trim();
  const reference = `refs/hive/reviews/${commit}`;
  git(repoPath, ["update-ref", reference, commit]);
  return { commit, reference };
}

function acquireDetachedReviewWorkspace(
  repoPath: string,
  reviewCommit: string
): ReviewWorkspace {
  const worktreesDirectory = join(repoPath, ".worktrees");
  mkdirSync(worktreesDirectory, { recursive: true });
  const path = join(worktreesDirectory, `.hive-review-${randomUUID()}`);
  git(repoPath, ["worktree", "add", "--detach", path, reviewCommit]);
  return {
    path,
    release() {
      const result = removeWorktree(repoPath, path);
      if (!result.ok) throw new Error(result.message);
    },
  };
}

function git(workspacePath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspacePath,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitLines(workspacePath: string, args: string[]): string[] {
  return git(workspacePath, args).split("\n").filter(Boolean);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
