/** @private — only imported by worker-supervisor.ts */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Card } from "../board-store";
import { readRequirements, requirementsRevision } from "../requirements-store";
import type { ReviewPackage } from "../reviewer";
import type { WorkerCompletion } from "./completion-gate";

export function buildReviewPackage(
  card: Card,
  repoPath: string,
  worktreePath: string,
  baseCommit: string,
  completion: WorkerCompletion
): ReviewPackage {
  const requirementsContent = readRequirements(repoPath);
  const headCommit = git(worktreePath, ["rev-parse", "HEAD"]);
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
      integrationCommit: git(repoPath, ["rev-parse", "HEAD"]),
      cardRevision: digest({
        title: card.title,
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
        relevantFiles: card.relevantFiles,
        dependencies: card.dependencies,
        requirementRefs: card.requirementRefs ?? [],
      }),
    },
    commits: commitList(worktreePath, baseCommit),
    changedFiles: gitLines(worktreePath, [
      "diff",
      "--name-only",
      `${baseCommit}...HEAD`,
    ]),
    diff: git(worktreePath, ["diff", "--no-ext-diff", `${baseCommit}...HEAD`]),
    diffStat: git(worktreePath, ["diff", "--stat", `${baseCommit}...HEAD`]),
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

function commitList(
  worktreePath: string,
  baseCommit: string
): Array<{ sha: string; subject: string }> {
  return gitLines(worktreePath, [
    "log",
    "--format=%H%x09%s",
    `${baseCommit}..HEAD`,
  ]).map((line) => {
    const separator = line.indexOf("\t");
    return {
      sha: line.slice(0, separator),
      subject: line.slice(separator + 1),
    };
  });
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
