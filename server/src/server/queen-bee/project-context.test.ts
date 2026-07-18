import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { loadProjectContext } from "./project-context";

describe("Shared Project Context", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("caches deterministic project context by committed revision", () => {
    const repoPath = createRepository();
    const cacheRoot = createDirectory("hive-context-cache-");

    const first = loadProjectContext("project-1", repoPath, cacheRoot);
    const second = loadProjectContext("project-1", repoPath, cacheRoot);

    assert.deepEqual(second, first);
    assert.deepEqual(first.files, ["package.json", "source.ts"]);
    assert.match(first.manifests["package.json"] ?? "", /context-test/);
    assert.equal(
      existsSync(join(cacheRoot, "project-1", `${first.revision}.json`)),
      true
    );
  });

  it("creates a new context when the committed revision changes", () => {
    const repoPath = createRepository();
    const cacheRoot = createDirectory("hive-context-cache-");
    const first = loadProjectContext("project-1", repoPath, cacheRoot);
    writeFileSync(join(repoPath, "new.ts"), "export const next = true;\n");
    git(repoPath, ["add", "new.ts"]);
    git(repoPath, ["commit", "-m", "source: add next revision"]);

    const second = loadProjectContext("project-1", repoPath, cacheRoot);

    assert.notEqual(second.revision, first.revision);
    assert.ok(second.files.includes("new.ts"));
  });

  function createRepository(): string {
    const repoPath = createDirectory("hive-context-repo-");
    git(repoPath, ["init", "-b", "main"]);
    git(repoPath, ["config", "user.name", "Hive Test"]);
    git(repoPath, ["config", "user.email", "hive@example.test"]);
    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify({ name: "context-test", scripts: { test: "node test" } })
    );
    writeFileSync(join(repoPath, "source.ts"), "export const value = true;\n");
    git(repoPath, ["add", "package.json", "source.ts"]);
    git(repoPath, ["commit", "-m", "source: initialize context"]);
    return repoPath;
  }

  function createDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }
});
