import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskDefinition } from "../../task-runner";
import type { OperationContext } from "../create-operation-runner";
import {
  commitFlowState,
  ensureIntegrationBranch,
  validateRepo,
} from "./git-operations";

const dummyTask: TaskDefinition = { id: "t", label: "T", role: "operation" };

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-gitops-"));
  execSync("git init -b main", { cwd: dir, encoding: "utf-8" });
  execSync("git config user.email test@example.com", {
    cwd: dir,
    encoding: "utf-8",
  });
  execSync("git config user.name Test", { cwd: dir, encoding: "utf-8" });
  execSync("git commit --allow-empty -m initial", {
    cwd: dir,
    encoding: "utf-8",
  });
  return dir;
}

function ctxFor(config: Record<string, unknown>): OperationContext {
  return {
    flowConfig: () => config,
    patchFlowConfig: () => {},
    instanceId: "i1",
    workflowId: "w1",
    currentState: "s1",
    workflowInstanceState: () => ({}),
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
  })
    .toString()
    .trim();
}

describe("git operations (config-driven)", () => {
  let root: string;
  let basePath: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("commitFlowState", () => {
    it("commits domainDir to integrationBranch via a temp worktree", () => {
      root = mkdtempSync(join(tmpdir(), "hive-commit-"));
      basePath = join(root, "repo");
      mkdirSync(basePath);
      execSync("git init -b main", { cwd: basePath, encoding: "utf-8" });
      execSync("git config user.email test@example.com", {
        cwd: basePath,
        encoding: "utf-8",
      });
      execSync("git config user.name Test", {
        cwd: basePath,
        encoding: "utf-8",
      });
      execSync("git commit --allow-empty -m initial", {
        cwd: basePath,
        encoding: "utf-8",
      });

      const flowDir = join(basePath, ".flow");
      mkdirSync(flowDir, { recursive: true });
      writeFileSync(join(flowDir, "note.md"), "hello", "utf-8");

      const result = commitFlowState(
        dummyTask,
        { message: "checkpoint" },
        ctxFor({
          basePath,
          integrationBranch: "integ",
          domainDir: ".flow",
        })
      );

      assert.equal(result.ok, true);
      const onBranch = execSync("git show integ:.flow/note.md", {
        cwd: basePath,
        encoding: "utf-8",
      }).trim();
      assert.equal(onBranch, "hello");
      const subject = execSync("git log -1 --format=%s integ", {
        cwd: basePath,
        encoding: "utf-8",
      }).trim();
      assert.equal(subject, "checkpoint");
      assert.equal(
        execSync("git branch --show-current", {
          cwd: basePath,
          encoding: "utf-8",
        }).trim(),
        "main"
      );
    });

    it("is a no-op when no repo is bound", () => {
      const result = commitFlowState(
        dummyTask,
        {},
        ctxFor({ integrationBranch: "integ", domainDir: ".flow" })
      );
      assert.deepEqual(result, { ok: true, skipped: true });
    });

    it("throws when integrationBranch is not configured", () => {
      root = mkdtempSync(join(tmpdir(), "hive-commit-"));
      basePath = setupRepo();
      assert.throws(
        () =>
          commitFlowState(
            dummyTask,
            {},
            ctxFor({ basePath, domainDir: ".flow" })
          ),
        /integrationBranch/
      );
    });
  });

  describe("ensureIntegrationBranch", () => {
    it("creates the configured integration branch", () => {
      root = mkdtempSync(join(tmpdir(), "hive-gitops-"));
      basePath = setupRepo();
      const result = ensureIntegrationBranch(
        dummyTask,
        { basePath },
        ctxFor({ basePath, integrationBranch: "integ" })
      );
      assert.equal(result.ok, true);
      assert.equal(result.branchName, "integ");
      assert.equal(
        git(basePath, ["rev-parse", "--verify", "integ"]).length > 0,
        true
      );
    });

    it("throws without flow config context", () => {
      root = mkdtempSync(join(tmpdir(), "hive-gitops-"));
      basePath = setupRepo();
      assert.throws(
        () => ensureIntegrationBranch(dummyTask, { basePath }),
        /integrationBranch/
      );
    });
  });

  describe("validateRepo", () => {
    it("accepts a valid git repository with a commit", () => {
      root = mkdtempSync(join(tmpdir(), "hive-gitops-"));
      basePath = setupRepo();
      const result = validateRepo(dummyTask, {}, ctxFor({ basePath }));
      assert.equal(result.ok, true);
    });

    it("throws for a non-repository directory", () => {
      root = mkdtempSync(join(tmpdir(), "hive-gitops-"));
      const plainDir = join(root, "not-a-repo");
      mkdirSync(plainDir);
      assert.throws(
        () => validateRepo(dummyTask, {}, ctxFor({ basePath: plainDir })),
        /not a git repository|is-inside-work-tree/
      );
    });
  });
});
