/** @public */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "./board-store";
import {
  ensureIntegrationBranch,
  type IntegrationRevision,
} from "./integration-manager";

export type ApprovedProjectSpecification = {
  projectId: string;
  requirements: string;
  cards: Card[];
};

export type ProjectSpecificationStore = {
  apply(
    repoPath: string,
    proposalId: string,
    specification: ApprovedProjectSpecification
  ): IntegrationRevision;
};

export function createProjectSpecificationStore(): ProjectSpecificationStore {
  return { apply: applySpecification };
}

function applySpecification(
  repoPath: string,
  proposalId: string,
  specification: ApprovedProjectSpecification
): IntegrationRevision {
  ensureIntegrationBranch(repoPath);
  const worktree = acquireIntegrationWorktree(repoPath);
  try {
    writeSpecification(worktree.path, specification);
    git(worktree.path, ["add", "-A", "--", ".hive"]);
    if (!gitSucceeds(worktree.path, ["diff", "--cached", "--quiet"])) {
      git(worktree.path, [
        "commit",
        "-m",
        `hive: apply planning proposal ${proposalId}`,
      ]);
    }
    return ensureIntegrationBranch(repoPath);
  } finally {
    if (worktree.temporary) removeWorktree(repoPath, worktree.path);
  }
}

function writeSpecification(
  worktreePath: string,
  specification: ApprovedProjectSpecification
): void {
  const hiveDirectory = join(worktreePath, ".hive");
  const cardsDirectory = join(hiveDirectory, "cards");
  mkdirSync(hiveDirectory, { recursive: true });
  rmSync(cardsDirectory, { recursive: true, force: true });
  mkdirSync(cardsDirectory, { recursive: true });

  writeFileSync(
    join(hiveDirectory, "requirements.md"),
    specification.requirements,
    "utf-8"
  );
  writeFileSync(
    join(hiveDirectory, "board.json"),
    JSON.stringify({
      projectId: specification.projectId,
      ideas: [],
      cards: specification.cards.map(persistedCard),
    }),
    "utf-8"
  );
  for (const card of specification.cards) {
    writeFileSync(
      join(cardsDirectory, `${card.id}.json`),
      JSON.stringify(persistedCard(card)),
      "utf-8"
    );
  }
}

function persistedCard(card: Card) {
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    acceptanceCriteria: card.acceptanceCriteria,
    relevantFiles: card.relevantFiles,
    dependencies: card.dependencies,
    createdAt: card.createdAt,
    requirementRefs: card.requirementRefs,
    originIdeaIds: card.originIdeaIds,
    archivedAt: card.archivedAt,
  };
}

function acquireIntegrationWorktree(repoPath: string): {
  path: string;
  temporary: boolean;
} {
  if (git(repoPath, ["branch", "--show-current"]) === "hive-main") {
    if (git(repoPath, ["status", "--porcelain", "--untracked-files=no"])) {
      throw new Error("hive-main is checked out with uncommitted changes");
    }
    return { path: repoPath, temporary: false };
  }
  const worktreesDirectory = join(repoPath, ".worktrees");
  mkdirSync(worktreesDirectory, { recursive: true });
  const path = join(worktreesDirectory, `.hive-specification-${randomUUID()}`);
  git(repoPath, ["worktree", "add", path, "hive-main"]);
  return { path, temporary: true };
}

function removeWorktree(repoPath: string, worktreePath: string): void {
  git(repoPath, ["worktree", "remove", "--force", worktreePath]);
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
