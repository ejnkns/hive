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
import { createProjectSpecificationStore } from "./project-specification-store";

describe("IntegrationManager", () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("creates hive-main without changing the user's checked-out branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
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
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, "workspaces", "test-project", "card-1");
    const branchName = "hive/card-1/attempt-1";
    mkdirSync(join(repoPath, "workspaces", "test-project"), {
      recursive: true,
    });
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
      projectId: "test-project",
      cardId: "card-1",
      branchName,
      worktreePath,
      reviewedHead,
      reviewedIntegrationRevision: integration.revision,
      requirementRefs: [],
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
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, "workspaces", "test-project", "card-1");
    const branchName = "hive/card-1/attempt-1";
    mkdirSync(join(repoPath, "workspaces", "test-project"), {
      recursive: true,
    });
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
          projectId: "test-project",
          cardId: "card-1",
          branchName,
          worktreePath,
          reviewedHead,
          reviewedIntegrationRevision: integration.revision,
          requirementRefs: [],
        }),
      /changed since review/
    );
    assert.equal(existsSync(worktreePath), true);
  });

  it("reports a parallel reviewed branch as refreshable after unrelated work is accepted", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const first = createAttempt(repoPath, "card-1", "first.txt", "first\n");
    const second = createAttempt(repoPath, "card-2", "second.txt", "second\n");

    manager.accept({
      repoPath,
      projectId: "test-project",
      cardId: "card-1",
      ...first,
      reviewedIntegrationRevision: integration.revision,
      requirementRefs: [],
    });

    const readiness = manager.reviewReadiness({
      repoPath,
      projectId: "test-project",
      cardId: "card-2",
      ...second,
      reviewedIntegrationRevision: integration.revision,
    });

    assert.equal(readiness.state, "stale");
    assert.equal(readiness.canAccept, false);
    assert.equal(readiness.canRefreshReview, true);
    assert.deepEqual(readiness.conflictingFiles, []);
  });

  it("reports conflicting files when parallel reviewed work cannot merge", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const first = createAttempt(repoPath, "card-1", "source.txt", "first\n");
    const second = createAttempt(repoPath, "card-2", "source.txt", "second\n");

    manager.accept({
      repoPath,
      projectId: "test-project",
      cardId: "card-1",
      ...first,
      reviewedIntegrationRevision: integration.revision,
      requirementRefs: [],
    });

    const readiness = manager.reviewReadiness({
      repoPath,
      projectId: "test-project",
      cardId: "card-2",
      ...second,
      reviewedIntegrationRevision: integration.revision,
    });

    assert.equal(readiness.state, "conflicted");
    assert.equal(readiness.canRefreshReview, false);
    assert.deepEqual(readiness.conflictingFiles, ["source.txt"]);
  });

  it("refuses to discard an attempt with uncommitted changes", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    manager.ensure(repoPath);
    const worktreePath = join(repoPath, "workspaces", "test-project", "card-1");
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
      () => manager.discardWorktree(repoPath, worktreePath, "test-project"),
      /uncommitted changes/
    );
    assert.equal(existsSync(worktreePath), true);
  });

  it("marks accepted requirementRefs as (done) in requirements.md", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, "workspaces", "test-project", "card-1");
    const branchName = "hive/card-1/attempt-1";
    mkdirSync(join(repoPath, "workspaces", "test-project"), {
      recursive: true,
    });
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
    mkdirSync(join(repoPath, ".hive"), { recursive: true });
    writeFileSync(
      join(repoPath, ".hive", "requirements.md"),
      [
        "# Requirements",
        "",
        "## Functional requirements",
        "- [FR-1] User can log in",
        "- [FR-2] User can log out",
        "",
        "## Acceptance criteria",
        "- [AC-1] Invalid credentials show an error",
      ].join("\n")
    );
    git(repoPath, ["add", ".hive/requirements.md"]);
    git(repoPath, ["commit", "-m", "chore: add requirements"]);
    const updatedIntegration = git(repoPath, ["rev-parse", "hive-main"]);
    git(repoPath, ["switch", "-"]);

    manager.accept({
      repoPath,
      projectId: "test-project",
      cardId: "card-1",
      branchName,
      worktreePath,
      reviewedHead,
      reviewedIntegrationRevision: updatedIntegration,
      requirementRefs: ["FR-1"],
    });

    const updated = git(repoPath, ["show", "hive-main:.hive/requirements.md"]);
    assert.ok(
      updated.includes("- [FR-1] (done) User can log in"),
      `FR-1 not marked done\n${updated}`
    );
    assert.ok(
      !updated.includes("- [FR-2] (done)"),
      "FR-2 should not be marked done"
    );
    assert.ok(
      !updated.includes("- [AC-1] (done)"),
      "AC-1 should not be marked done"
    );
  });

  it("accepts work while the user has hive-main checked out", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    const integration = manager.ensure(repoPath);
    const worktreePath = join(repoPath, "workspaces", "test-project", "card-1");
    const branchName = "hive/card-1/attempt-1";
    mkdirSync(join(repoPath, "workspaces", "test-project"), {
      recursive: true,
    });
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
      projectId: "test-project",
      cardId: "card-1",
      branchName,
      worktreePath,
      reviewedHead,
      reviewedIntegrationRevision: integration.revision,
      requirementRefs: [],
    });

    assert.equal(git(repoPath, ["branch", "--show-current"]), "hive-main");
    assert.equal(git(repoPath, ["show", "HEAD:feature.txt"]), "accepted");
  });

  it("commits approved planning files on hive-main without switching the user branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    manager.ensure(repoPath);
    mkdirSync(join(repoPath, ".hive"), { recursive: true });
    writeFileSync(join(repoPath, ".hive", "requirements.md"), "# Approved\n");
    writeFileSync(
      join(repoPath, ".hive", "board.json"),
      JSON.stringify({ projectId: "project-1", cards: [] })
    );

    const result = manager.commitPlanningSnapshot(
      repoPath,
      "proposal-1",
      "test-project"
    );

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

  it("applies an approved specification without dirtying the checked-out target branch", () => {
    const repoPath = createRepository();
    const specifications = createProjectSpecificationStore(repoPath);

    specifications.apply(
      repoPath,
      "proposal-1",
      {
        projectId: "project-1",
        requirements: "# Approved requirements\n",
        cards: [],
      },
      "test-project"
    );

    assert.equal(git(repoPath, ["status", "--porcelain"]), "");
    assert.equal(
      git(repoPath, ["show", "hive-main:.hive/requirements.md"]),
      "# Approved requirements"
    );
    assert.deepEqual(
      JSON.parse(git(repoPath, ["show", "hive-main:.hive/board.json"])),
      { projectId: "project-1", ideas: [], cards: [] }
    );
  });

  it("reports accepted Hive work waiting to be integrated into the target branch", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
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

  it("refuses integration when the target checkout has user changes", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
    manager.ensure(repoPath);
    git(repoPath, ["switch", "hive-main"]);
    writeFileSync(join(repoPath, "accepted.txt"), "accepted\n");
    git(repoPath, ["add", "accepted.txt"]);
    git(repoPath, ["commit", "-m", "feature: accept work"]);
    git(repoPath, ["switch", "main"]);
    writeFileSync(join(repoPath, "user-change.txt"), "do not overwrite\n");

    assert.throws(
      () => manager.integrate(repoPath, "main"),
      /checked out with uncommitted changes/
    );
    assert.equal(
      git(repoPath, ["status", "--porcelain"]),
      "?? user-change.txt"
    );
  });

  it("fast-forwards an explicitly selected target branch without switching branches", () => {
    const repoPath = createRepository();
    const manager = createIntegrationManager(repoPath);
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
    const manager = createIntegrationManager(repoPath);
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

  function createAttempt(
    repoPath: string,
    cardId: string,
    filename: string,
    content: string
  ): {
    branchName: string;
    worktreePath: string;
    reviewedHead: string;
  } {
    const branchName = `hive/${cardId}/attempt-1`;
    const worktreePath = join(repoPath, "workspaces", "test-project", cardId);
    mkdirSync(join(repoPath, "workspaces", "test-project"), {
      recursive: true,
    });
    git(repoPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      "hive-main",
    ]);
    writeFileSync(join(worktreePath, filename), content);
    git(worktreePath, ["add", filename]);
    git(worktreePath, ["commit", "-m", `feature: implement ${cardId}`]);
    return {
      branchName,
      worktreePath,
      reviewedHead: git(worktreePath, ["rev-parse", "HEAD"]),
    };
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }
});
