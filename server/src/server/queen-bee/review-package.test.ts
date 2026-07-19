import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Card } from "./board-store";
import { buildRefreshedReviewPackage } from "./review-package";
import type { ReviewPackage } from "./reviewer";

describe("refreshed Review Packages", () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("reviews the Worker change combined with the latest hive-main tree", () => {
    const repoPath = createRepository();
    const workerPath = join(repoPath, ".worktrees", "worker");
    const integrationPath = join(repoPath, ".worktrees", "integration");
    git(repoPath, ["branch", "hive-main"]);
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      "hive/card-1/attempt-1",
      workerPath,
      "hive-main",
    ]);
    writeFileSync(join(workerPath, "worker.txt"), "worker\n");
    git(workerPath, ["add", "worker.txt"]);
    git(workerPath, ["commit", "-m", "worker: add feature"]);
    const workerHead = git(workerPath, ["rev-parse", "HEAD"]);

    git(repoPath, ["worktree", "add", integrationPath, "hive-main"]);
    writeFileSync(join(integrationPath, "accepted.txt"), "accepted\n");
    git(integrationPath, ["add", "accepted.txt"]);
    git(integrationPath, ["commit", "-m", "feature: accept parallel work"]);
    const integrationHead = git(integrationPath, ["rev-parse", "HEAD"]);
    git(repoPath, ["worktree", "remove", integrationPath]);

    const refreshed = buildRefreshedReviewPackage(
      card(),
      repoPath,
      workerPath,
      integrationHead,
      previousPackage(workerHead)
    );

    assert.equal(
      readFileSync(join(refreshed.workspace.path, "worker.txt"), "utf-8"),
      "worker\n"
    );
    assert.equal(
      readFileSync(join(refreshed.workspace.path, "accepted.txt"), "utf-8"),
      "accepted\n"
    );
    assert.equal(refreshed.reviewPackage.revisions.headCommit, workerHead);
    assert.notEqual(refreshed.reviewPackage.revisions.reviewCommit, workerHead);
    assert.deepEqual(refreshed.reviewPackage.changedFiles, ["worker.txt"]);
    const reviewPath = refreshed.workspace.path;
    refreshed.workspace.release();
    assert.equal(existsSync(reviewPath), false);
  });

  function createRepository(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-review-package-"));
    repositories.push(repoPath);
    mkdirSync(join(repoPath, ".hive"), { recursive: true });
    writeFileSync(
      join(repoPath, ".hive", "requirements.md"),
      "# Requirements\n"
    );
    writeFileSync(join(repoPath, "initial.txt"), "initial\n");
    git(repoPath, ["init", "-b", "main"]);
    git(repoPath, ["config", "user.name", "Hive Test"]);
    git(repoPath, ["config", "user.email", "hive@example.test"]);
    git(repoPath, ["add", "."]);
    git(repoPath, ["commit", "-m", "source: initialize"]);
    return repoPath;
  }

  function card(): Card {
    return {
      id: "card-1",
      title: "Add feature",
      description: "Add worker.txt",
      acceptanceCriteria: ["worker.txt exists"],
      relevantFiles: ["worker.txt"],
      dependencies: [],
      requirementRefs: [],
      column: "reviewing",
      createdAt: "2026-07-19T00:00:00.000Z",
    };
  }

  function previousPackage(workerHead: string): ReviewPackage {
    return {
      id: "previous",
      card: {
        id: "card-1",
        title: "Add feature",
        description: "Add worker.txt",
        acceptanceCriteria: ["worker.txt exists"],
        requirementRefs: [],
      },
      requirements: { revision: "requirements", content: "# Requirements" },
      revisions: {
        baseCommit: workerHead,
        headCommit: workerHead,
        reviewCommit: workerHead,
        integrationCommit: workerHead,
        cardRevision: "card",
      },
      commits: [],
      changedFiles: ["worker.txt"],
      diff: "",
      diffStat: "",
      verification: { commands: [] },
    };
  }
});

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}
