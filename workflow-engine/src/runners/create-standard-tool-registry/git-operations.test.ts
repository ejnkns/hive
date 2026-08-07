import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
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
import type { TaskDefinition } from "../../task-runner";
import type { OperationContext } from "../create-operation-runner";
import {
  commitFlowState,
  ensureIntegrationBranch,
  fastForwardTargetBranch,
  mergeBranch,
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

function ctxFor(
  config: Record<string, unknown>,
  instanceState: Record<string, unknown> = {}
): OperationContext {
  return {
    flowConfig: () => config,
    patchFlowConfig: () => {},
    instanceId: "i1",
    workflowId: "w1",
    currentState: "s1",
    workflowInstanceState: () => instanceState,
    taskOutputs: () => ({}),
    patchWorkflowInstanceState: () => {},
    workflowInstancesInState: () => [],
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

  describe("fastForwardTargetBranch", () => {
    it("fast-forwards even when the flow's domain state is untracked in the target checkout", () => {
      root = mkdtempSync(join(tmpdir(), "hive-ff-"));
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
      writeFileSync(join(basePath, "legacy.txt"), "legacy tracked file\n");
      execSync("git add -A && git commit -m legacy", {
        cwd: basePath,
        encoding: "utf-8",
      });

      // Integration branch: the feature + committed domain state.
      execSync("git checkout -b integ", { cwd: basePath, encoding: "utf-8" });
      writeFileSync(join(basePath, "main.py"), "feature\n");
      mkdirSync(join(basePath, ".hive-state"));
      writeFileSync(join(basePath, ".hive-state", "requirements.md"), "spec\n");
      execSync("git add -A && git commit -m feature", {
        cwd: basePath,
        encoding: "utf-8",
      });
      execSync("git checkout main", { cwd: basePath, encoding: "utf-8" });

      // Simulate the flow's artifacts in the target checkout: the domain dir
      // is untracked but identical to the integration branch's committed
      // version, and a legacy tracked file sits deleted (uncommitted) — the
      // merge touches neither, so integration must proceed.
      mkdirSync(join(basePath, ".hive-state"));
      writeFileSync(join(basePath, ".hive-state", "requirements.md"), "spec\n");
      rmSync(join(basePath, "legacy.txt"));

      const ctx = ctxFor({
        basePath,
        integrationBranch: "integ",
        branchPrefix: "hive/",
        domainDir: ".hive-state",
      });
      const result = fastForwardTargetBranch(
        dummyTask,
        { basePath, targetBranch: "main" },
        ctx
      );

      assert.equal(result.ok, true);
      assert.equal(
        git(basePath, ["rev-parse", "main"]),
        git(basePath, ["rev-parse", "integ"]),
        "main fast-forwarded to the integration head"
      );
      assert.ok(
        existsSync(join(basePath, ".hive-state", "requirements.md")),
        "the committed domain state arrived via the merge"
      );
    });

    it("refuses when a real local change would be overwritten by the merge", () => {
      root = mkdtempSync(join(tmpdir(), "hive-ff-"));
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
      writeFileSync(join(basePath, "main.py"), "base\n");
      execSync("git add -A && git commit -m initial", {
        cwd: basePath,
        encoding: "utf-8",
      });

      execSync("git checkout -b integ", { cwd: basePath, encoding: "utf-8" });
      writeFileSync(join(basePath, "main.py"), "feature\n");
      execSync("git add -A && git commit -m feature", {
        cwd: basePath,
        encoding: "utf-8",
      });
      execSync("git checkout main", { cwd: basePath, encoding: "utf-8" });

      // A real local edit to a file the merge will change must still block.
      writeFileSync(join(basePath, "main.py"), "local uncommitted edit\n");

      const ctx = ctxFor({
        basePath,
        integrationBranch: "integ",
        branchPrefix: "hive/",
        domainDir: ".hive-state",
      });
      assert.throws(
        () =>
          fastForwardTargetBranch(
            dummyTask,
            { basePath, targetBranch: "main" },
            ctx
          ),
        /overwritten|local changes/i
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

  describe("mergeBranch", () => {
    function setupMergeRepo(): {
      basePath: string;
      worktree: string;
      featureBranch: string;
    } {
      root = mkdtempSync(join(tmpdir(), "hive-merge-"));
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
      execSync("git branch integ", { cwd: basePath, encoding: "utf-8" });

      const worktree = join(root, "wt");
      execSync(`git worktree add ${worktree} integ`, {
        cwd: basePath,
        encoding: "utf-8",
      });
      const featureBranch = "queen-bee/i1/attempt-1";
      execSync(`git checkout -b ${featureBranch}`, {
        cwd: worktree,
        encoding: "utf-8",
      });
      writeFileSync(join(worktree, "x.txt"), "work\n");
      execSync("git add -A && git commit -m work", {
        cwd: worktree,
        encoding: "utf-8",
      });
      return { basePath, worktree, featureBranch };
    }

    it("no-ff merges the feature branch into the integration branch and cleans up", () => {
      const { basePath, worktree, featureBranch } = setupMergeRepo();

      const result = mergeBranch(
        dummyTask,
        {},
        ctxFor(
          {
            basePath,
            integrationBranch: "integ",
            branchPrefix: "queen-bee/",
          },
          { attempt: 1, worktreePath: worktree }
        )
      );

      assert.equal(result.ok, true);
      assert.equal(result.merged, featureBranch);
      assert.equal(
        execSync("git show integ:x.txt", {
          cwd: basePath,
          encoding: "utf-8",
        }).trim(),
        "work"
      );
      // no-ff: the integration tip is a merge commit with two parents
      const parents = execSync("git rev-list --parents -n 1 integ", {
        cwd: basePath,
        encoding: "utf-8",
      })
        .trim()
        .split(" ");
      assert.equal(parents.length, 3);
      // feature branch deleted
      const refs = execSync("git for-each-ref refs/heads", {
        cwd: basePath,
        encoding: "utf-8",
      }).toString();
      assert.ok(!refs.includes(`refs/heads/${featureBranch}`));
      // card worktree discarded
      assert.ok(!existsSync(worktree));
    });

    it("merges a branchName passed as a param", () => {
      const { basePath, worktree } = setupMergeRepo();
      execSync("git checkout -b custom/feature", {
        cwd: worktree,
        encoding: "utf-8",
      });
      writeFileSync(join(worktree, "y.txt"), "other\n");
      execSync("git add -A && git commit -m other", {
        cwd: worktree,
        encoding: "utf-8",
      });

      const result = mergeBranch(
        dummyTask,
        { branchName: "custom/feature" },
        ctxFor(
          {
            basePath,
            integrationBranch: "integ",
            branchPrefix: "queen-bee/",
          },
          { attempt: 1, worktreePath: worktree }
        )
      );

      assert.equal(result.ok, true);
      assert.equal(result.merged, "custom/feature");
      assert.equal(
        execSync("git show integ:y.txt", {
          cwd: basePath,
          encoding: "utf-8",
        }).trim(),
        "other"
      );
    });

    it("is a no-op when no repo is bound", () => {
      const result = mergeBranch(
        dummyTask,
        {},
        ctxFor({ integrationBranch: "integ", branchPrefix: "queen-bee/" })
      );
      assert.deepEqual(result, { ok: true, skipped: true });
    });

    it("throws when integrationBranch or branchPrefix is not configured", () => {
      root = mkdtempSync(join(tmpdir(), "hive-merge-"));
      basePath = setupRepo();
      assert.throws(
        () =>
          mergeBranch(
            dummyTask,
            {},
            ctxFor({ basePath, branchPrefix: "queen-bee/" })
          ),
        /integrationBranch/
      );
      assert.throws(
        () =>
          mergeBranch(
            dummyTask,
            {},
            ctxFor({ basePath, integrationBranch: "integ" })
          ),
        /branchPrefix/
      );
    });
  });
});
