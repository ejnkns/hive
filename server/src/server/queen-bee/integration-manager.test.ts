import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createIntegrationManager } from "./integration-manager";

describe("IntegrationManager", () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("creates hive-main without changing the user's checked-out branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    const originalBranch = git(repoPath, ["branch", "--show-current"]);
    const originalHead = git(repoPath, ["rev-parse", "HEAD"]);

    const integration = manager.ensure(repoPath);

    assert.equal(integration.branchName, "hive-main");
    assert.equal(integration.revision, originalHead);
    assert.equal(git(repoPath, ["branch", "--show-current"]), originalBranch);
    assert.equal(git(repoPath, ["rev-parse", "hive-main"]), originalHead);
  });

  it("merges an explicitly accepted reviewed branch and cleans up its worktree", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, ".worktrees", "card-1");
    const branchName = "hive/card-1/attempt-1";
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      "hive-main",
    ]);
    writeFileSync(join(worktreePath, "feature.txt"), "accepted\n");
    git(worktreePath, ["add", "feature.txt"]);
    git(worktreePath, ["commit", "-m", "feature: add accepted work"]);
    const reviewedHead = git(worktreePath, ["rev-parse", "HEAD"]);

    const accepted = manager.accept({
      repoPath,
      cardId: "card-1",
      branchName,
      worktreePath,
      reviewedHead,
      reviewedIntegrationRevision: integration.revision,
    });

    assert.equal(accepted.branchName, "hive-main");
    assert.equal(git(repoPath, ["show", "hive-main:feature.txt"]), "accepted");
    assert.equal(
      git(repoPath, ["rev-list", "--parents", "-n", "1", "hive-main"]).split(
        " "
      ).length,
      3,
      "acceptance produces a merge commit"
    );
    assert.equal(existsSync(worktreePath), false);
    assert.equal(git(repoPath, ["branch", "--list", branchName]), "");
  });

  it("rejects acceptance when the reviewed branch has changed", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, ".worktrees", "card-1");
    const branchName = "hive/card-1/attempt-1";
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      "hive-main",
    ]);
    const reviewedHead = git(worktreePath, ["rev-parse", "HEAD"]);
    writeFileSync(join(worktreePath, "late.txt"), "stale\n");
    git(worktreePath, ["add", "late.txt"]);
    git(worktreePath, ["commit", "-m", "feature: mutate after review"]);

    assert.throws(
      () =>
        manager.accept({
          repoPath,
          cardId: "card-1",
          branchName,
          worktreePath,
          reviewedHead,
          reviewedIntegrationRevision: integration.revision,
        }),
      /changed since review/
    );
    assert.equal(existsSync(worktreePath), true);
  });

  it("refuses to discard an attempt with uncommitted changes", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    manager.ensure(repoPath);
    const worktreePath = join(repoPath, ".worktrees", "card-1");
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      "hive/card-1/attempt-1",
      worktreePath,
      "hive-main",
    ]);
    writeFileSync(join(worktreePath, "uncommitted.txt"), "preserve\n");

    assert.throws(
      () => manager.discardWorktree(repoPath, worktreePath),
      /uncommitted changes/
    );
    assert.equal(existsSync(worktreePath), true);
  });

  it("accepts work while the user has hive-main checked out", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, ".worktrees", "card-1");
    const branchName = "hive/card-1/attempt-1";
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      "hive-main",
    ]);
    writeFileSync(join(worktreePath, "feature.txt"), "accepted\n");
    git(worktreePath, ["add", "feature.txt"]);
    git(worktreePath, ["commit", "-m", "feature: add accepted work"]);
    const reviewedHead = git(worktreePath, ["rev-parse", "HEAD"]);
    git(repoPath, ["switch", "hive-main"]);

    manager.accept({
      repoPath,
      cardId: "card-1",
      branchName,
      worktreePath,
      reviewedHead,
      reviewedIntegrationRevision: integration.revision,
    });

    assert.equal(git(repoPath, ["branch", "--show-current"]), "hive-main");
    assert.equal(git(repoPath, ["show", "HEAD:feature.txt"]), "accepted");
  });

  it("commits approved planning files on hive-main without switching the user branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    manager.ensure(repoPath);
    mkdirSync(join(repoPath, ".hive"), { recursive: true });
    writeFileSync(join(repoPath, ".hive", "requirements.md"), "# Approved\n");
    writeFileSync(
      join(repoPath, ".hive", "board.json"),
      JSON.stringify({ projectId: "project-1", cards: [] })
    );

    const result = manager.commitPlanningSnapshot(repoPath, "proposal-1");

    assert.equal(git(repoPath, ["branch", "--show-current"]), "main");
    assert.equal(
      git(repoPath, ["show", "hive-main:.hive/requirements.md"]),
      "# Approved"
    );
    assert.equal(result.revision, git(repoPath, ["rev-parse", "hive-main"]));
    assert.equal(
      git(repoPath, ["log", "-1", "--format=%s", "hive-main"]),
      "hive: apply planning proposal proposal-1"
    );
  });

  it("reports accepted Hive work waiting to be integrated into the target branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    manager.ensure(repoPath);
    git(repoPath, ["switch", "hive-main"]);
    writeFileSync(join(repoPath, "accepted.txt"), "accepted\n");
    git(repoPath, ["add", "accepted.txt"]);
    git(repoPath, ["commit", "-m", "feature: accept work"]);
    git(repoPath, ["switch", "main"]);

    const status = manager.status(repoPath, "main");

    assert.equal(status.state, "ready");
    assert.equal(status.ahead, 1);
    assert.equal(status.behind, 0);
    assert.equal(status.canIntegrate, true);
  });

  it("fast-forwards an explicitly selected target branch without switching branches", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    manager.ensure(repoPath);
    git(repoPath, ["switch", "hive-main"]);
    writeFileSync(join(repoPath, "accepted.txt"), "accepted\n");
    git(repoPath, ["add", "accepted.txt"]);
    git(repoPath, ["commit", "-m", "feature: accept work"]);
    git(repoPath, ["switch", "main"]);
    git(repoPath, ["switch", "-c", "user-work"]);

    const status = manager.integrate(repoPath, "main");

    assert.equal(status.state, "integrated");
    assert.equal(git(repoPath, ["branch", "--show-current"]), "user-work");
    assert.equal(git(repoPath, ["show", "main:accepted.txt"]), "accepted");
  });

  it("detects manual integration and refuses divergent branches", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager();
    manager.ensure(repoPath);
    git(repoPath, ["switch", "hive-main"]);
    writeFileSync(join(repoPath, "accepted.txt"), "accepted\n");
    git(repoPath, ["add", "accepted.txt"]);
    git(repoPath, ["commit", "-m", "feature: accept work"]);
    git(repoPath, ["switch", "main"]);
    git(repoPath, ["merge", "--ff-only", "hive-main"]);

    assert.equal(manager.status(repoPath, "main").state, "integrated");

    writeFileSync(join(repoPath, "target.txt"), "target\n");
    git(repoPath, ["add", "target.txt"]);
    git(repoPath, ["commit", "-m", "feature: target-only work"]);
    git(repoPath, ["switch", "hive-main"]);
    writeFileSync(join(repoPath, "hive.txt"), "hive\n");
    git(repoPath, ["add", "hive.txt"]);
    git(repoPath, ["commit", "-m", "feature: hive-only work"]);
    git(repoPath, ["switch", "main"]);

    assert.equal(manager.status(repoPath, "main").state, "diverged");
    assert.throws(() => manager.integrate(repoPath, "main"), /diverged/);
  });

  function createRepository(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-integration-"));
    repositories.push(repoPath);
    git(repoPath, ["init", "-b", "main"]);
    git(repoPath, ["config", "user.name", "Hive Test"]);
    git(repoPath, ["config", "user.email", "hive@example.test"]);
    writeFileSync(join(repoPath, "source.txt"), "base\n");
    git(repoPath, ["add", "source.txt"]);
    git(repoPath, ["commit", "-m", "source: add base"]);
    return repoPath;
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }
});
