import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { executeWorkerTool, WORKER_TOOLS } from "./worker-tools";

describe("worker tools", () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("keeps canonical requirements outside the worker capability set", async () => {
    const repoPath = createGitRepository();
    const names = WORKER_TOOLS.map((tool) => tool.function.name);

    assert.equal(names.includes("update_requirements"), false);
    assert.equal(names.includes("commit_work"), true);
    assert.equal(names.includes("submit_work"), true);

    const result = await executeWorkerTool(
      toolCall("update_requirements", {
        content: "# Worker-authored requirements",
      }),
      repoPath
    );

    assert.equal(result.isError, true);
    assert.match(result.content, /Unknown tool/);
    assert.equal(existsSync(join(repoPath, ".hive", "requirements.md")), false);
  });

  it("requires executable and arguments instead of shell command strings", async () => {
    const repoPath = createGitRepository();

    const malformed = await executeWorkerTool(
      toolCall("run_command", { command: "git --version" }),
      repoPath
    );
    const valid = await executeWorkerTool(
      toolCall("run_command", { command: "git", args: ["--version"] }),
      repoPath
    );

    assert.equal(malformed.isError, true);
    assert.match(malformed.content, /executable name only/i);
    assert.match(malformed.content, /args/i);
    assert.equal(valid.isError, false);
    assert.match(valid.content, /git version/);
  });

  it("rejects direct Git mutation commands", async () => {
    const repoPath = createGitRepository();

    const result = await executeWorkerTool(
      toolCall("run_command", {
        command: "git",
        args: ["commit", "-m", "bypass"],
      }),
      repoPath
    );

    assert.equal(result.isError, true);
    assert.match(result.content, /commit_work/);
    assert.equal(git(repoPath, ["rev-list", "--count", "HEAD"]), "1");
  });

  it("commits only explicitly declared files through repository hooks", async () => {
    const repoPath = createGitRepository();
    writeFileSync(join(repoPath, "source.txt"), "implemented\n", "utf-8");
    writeFileSync(join(repoPath, "unrelated.txt"), "leave dirty\n", "utf-8");

    const result = await executeWorkerTool(
      toolCall("commit_work", {
        message: "worker: implement source change",
        paths: ["source.txt"],
      }),
      repoPath
    );

    assert.equal(result.isError, false, result.content);
    const committed = JSON.parse(result.content) as {
      commit: string;
      files: string[];
    };
    assert.match(committed.commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(committed.files, ["source.txt"]);
    assert.equal(git(repoPath, ["show", "HEAD:source.txt"]), "implemented");
    assert.equal(
      readFileSync(join(repoPath, "unrelated.txt"), "utf-8"),
      "leave dirty\n"
    );
    assert.equal(git(repoPath, ["status", "--short"]), "?? unrelated.txt");
  });

  function createGitRepository(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-worker-tools-"));
    repositories.push(repoPath);
    execFileSync("git", ["init", "--quiet"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Hive Test"], {
      cwd: repoPath,
    });
    execFileSync("git", ["config", "user.email", "hive@example.test"], {
      cwd: repoPath,
    });
    writeFileSync(join(repoPath, "source.txt"), "initial\n", "utf-8");
    execFileSync("git", ["add", "source.txt"], { cwd: repoPath });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], {
      cwd: repoPath,
    });
    return repoPath;
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }

  function toolCall(name: string, args: object) {
    return { id: `${name}-1`, name, arguments: JSON.stringify(args) };
  }
});
