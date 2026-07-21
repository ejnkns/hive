import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ProjectRegistry } from "./create-project-store";
import { createProject } from "./create-project-store/create-project";
import { unlinkProject } from "./create-project-store/unlink-project";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-test-"));
  writeFileSync(join(dir, "package.json"), "{}");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Hive Test"]);
  git(dir, ["config", "user.email", "hive@example.test"]);
  git(dir, ["add", "package.json"]);
  git(dir, ["commit", "-m", "source: initialize project"]);
  return dir;
}

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

describe("createProject", () => {
  it("keeps the checked-out repository clean when linking a project", () => {
    const repoPath = createTempGitRepo();
    const project = createProject(repoPath, "my-project");

    assert.strictEqual(project.name, "my-project");
    assert.strictEqual(project.repoPath, repoPath);
    assert.strictEqual(project.id, "my-project");
    assert.strictEqual(project.systemPrompt, "");
    assert.strictEqual(project.codingGuidelines, "");
    assert.strictEqual(project.targetBranch, "main");
    assert.strictEqual(project.maxConcurrentWorkers, 3);

    assert.strictEqual(git(repoPath, ["status", "--porcelain"]), "");
  });

  it("generates slug-based ID from project name", () => {
    const repoPath = createTempGitRepo();
    const project = createProject(repoPath, "My Cool Project!");

    assert.strictEqual(project.id, "my-cool-project");
  });

  it("uses directory name as default project name", () => {
    const repoPath = createTempGitRepo();
    const dirName = repoPath.split("/").pop() ?? repoPath;
    const project = createProject(repoPath);

    assert.strictEqual(project.name, dirName);
  });

  it("rejects non-git paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-test-"));
    assert.throws(() => createProject(dir, "test"), /Not a git repository/);
  });

  it("detects ID collisions and appends suffix", () => {
    const repo1 = createTempGitRepo();
    const repo2 = createTempGitRepo();

    const registry: ProjectRegistry = { projects: {} };
    const p1 = createProject(repo1, "my-app", registry);
    registry.projects[p1.id] = { path: repo1 };
    const p2 = createProject(repo2, "my-app", registry);

    assert.strictEqual(p1.id, "my-app");
    assert.strictEqual(p2.id, "my-app-2");
  });

  it("increments collision suffix correctly", () => {
    const repo1 = createTempGitRepo();
    const repo2 = createTempGitRepo();
    const repo3 = createTempGitRepo();

    const registry: ProjectRegistry = { projects: {} };
    const p1 = createProject(repo1, "my-app", registry);
    registry.projects[p1.id] = { path: repo1 };
    const p2 = createProject(repo2, "my-app", registry);
    registry.projects[p2.id] = { path: repo2 };
    const p3 = createProject(repo3, "my-app", registry);

    assert.strictEqual(p3.id, "my-app-3");
  });
});

describe("unlinkProject", () => {
  it("removes entry from registry", () => {
    const registry: ProjectRegistry = {
      projects: { "my-app": { path: "/test" } },
    };
    unlinkProject("my-app", registry);
    assert.deepStrictEqual(registry, { projects: {} });
  });

  it("throws for unknown project", () => {
    const registry: ProjectRegistry = { projects: {} };
    assert.throws(() => unlinkProject("nonexistent", registry));
  });
});
