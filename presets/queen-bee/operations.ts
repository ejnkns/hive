import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationContext, OperationFn } from "workflow-engine/runners";
import {
  ensureIntegrationBranch,
  fastForwardTargetBranch,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

// === QUEEN BEE DOMAIN OPERATIONS ===
//
// Deterministic operations referenced by name in queen-bee workflow tasks.
// Infrastructure operations (prepare_worktree, patch_flow_config) ship in the
// engine; these are queen-bee-specific and belong to the preset. The engine
// invokes them without interpreting what they mean.
//
// Operations read the repo binding from the flow runtime context
// (ctx.flowConfig()) — a queen-bee flow is bound to a repository by its
// Onboarding Workflow.

// ── Onboarding operations ──

function validateRepo(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const repoPath = resolveRepoPath(ctx);
    validateGitRepo(repoPath);
    ensureRepoInitialized(repoPath);
    return { ok: true, repoPath };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function ensureIntegrationBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const repoPath = resolveRepoPath(ctx);
    const result = ensureIntegrationBranch(task, { repoPath });
    if (result.ok !== true) return result;

    const targetBranch = inferTargetBranch(repoPath);
    ctx.patchFlowConfig({ repoPath, targetBranch });
    return { ok: true, targetBranch };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function writeProjectMetadata(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const config = ctx.flowConfig();
    const repoPath = resolveRepoPath(ctx);
    const name =
      typeof config.name === "string"
        ? config.name
        : (repoPath.split("/").pop() ?? repoPath);
    const targetBranch =
      typeof config.targetBranch === "string" ? config.targetBranch : "main";

    const hiveDir = join(repoPath, ".hive");
    mkdirSync(hiveDir, { recursive: true });
    const projectJsonPath = join(hiveDir, "project.json");
    writeFileSync(
      projectJsonPath,
      JSON.stringify({ name, repoPath, targetBranch }, null, 2)
    );
    return { ok: true, path: projectJsonPath };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Integration operation ──

function fastForwardTargetBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const config = ctx.flowConfig();
    const repoPath = typeof config.repoPath === "string" ? config.repoPath : "";
    const targetBranch =
      typeof config.targetBranch === "string" ? config.targetBranch : "main";
    return fastForwardTargetBranch(task, { repoPath, targetBranch });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Operation exports ──

export const queenBeeOperations: Record<string, OperationFn> = {
  validate_repo: validateRepo,
  ensure_integration_branch: ensureIntegrationBranchOp,
  write_project_metadata: writeProjectMetadata,
  fast_forward_target_branch: fastForwardTargetBranchOp,
  validate_completion: (_task, _params) => ({ ok: true }),
  build_review_package: (_task, _params) => ({ packageId: "placeholder" }),
};

// ── Git helpers ──

type OperationResult = Record<string, unknown>;

function readRepoPath(ctx: OperationContext): string {
  const raw = ctx.flowConfig().repoPath;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Flow config repoPath is not set");
  }
  return raw;
}

function resolveRepoPath(ctx: OperationContext): string {
  const repoPath = readRepoPath(ctx);
  return repoPath.startsWith("/") ? repoPath : join(process.cwd(), repoPath);
}

function validateGitRepo(repoPath: string): void {
  const stat = statSync(join(repoPath, ".git"));
  if (!stat.isDirectory()) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

function ensureRepoInitialized(repoPath: string): void {
  try {
    execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
    return;
  } catch {
    // no commits yet
  }
  try {
    writeFileSync(
      join(repoPath, "README.md"),
      `# ${repoPath.split("/").pop()}\n`
    );
    execSync("git add -A", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    execSync('git commit -m "Initial commit"', {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    });
  } catch {
    try {
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5_000,
      });
    } catch {
      // ignore
    }
  }
}

function inferTargetBranch(repoPath: string): string {
  const current = gitOptional(repoPath, ["branch", "--show-current"]);
  if (current && current !== "hive-main") return current;

  const branches = gitOptional(repoPath, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter(
      (b) =>
        b && b !== "hive-main" && !b.startsWith("hive/") && !b.startsWith("qb/")
    );
  const preferred =
    branches.find((b) => b === "main") ??
    branches.find((b) => b === "master") ??
    branches[0];
  if (!preferred) {
    throw new Error("Project requires a target branch for Hive integration");
  }
  return preferred;
}

function gitOptional(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Queen bee operation failed";
}
