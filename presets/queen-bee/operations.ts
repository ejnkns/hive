import { execFileSync, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationContext, OperationFn } from "workflow-engine/runners";
import {
  ensureIntegrationBranch,
  fastForwardTargetBranch,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import {
  type BoardCardStatus,
  type CardSpec,
  readDraft,
  readRequirements,
  recordCardEvent,
  upsertCard,
  upsertIdea,
  writeRequirements,
  writeReviewPackage,
} from "./domain-state";

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
    const basePath = resolveBasePath(ctx);
    validateGitRepo(basePath);
    ensureRepoInitialized(basePath);
    return { ok: true, basePath };
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
    const basePath = resolveBasePath(ctx);
    const result = ensureIntegrationBranch(task, { basePath });
    if (result.ok !== true) return result;

    const targetBranch = inferTargetBranch(basePath);
    ctx.patchFlowConfig({ basePath, targetBranch });
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
    const basePath = resolveBasePath(ctx);
    const name =
      typeof config.name === "string"
        ? config.name
        : (basePath.split("/").pop() ?? basePath);
    const targetBranch =
      typeof config.targetBranch === "string" ? config.targetBranch : "main";

    const hiveDir = join(basePath, ".hive");
    mkdirSync(hiveDir, { recursive: true });
    const projectJsonPath = join(hiveDir, "project.json");
    writeFileSync(
      projectJsonPath,
      JSON.stringify({ name, basePath, targetBranch }, null, 2)
    );
    return { ok: true, path: projectJsonPath };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Requirements persistence ──

function finalizeRequirementsOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const basePath = resolveBasePath(ctx);
    const draft = readDraft(basePath);
    if (!draft) {
      return { ok: false, error: "No requirements draft to finalize" };
    }
    const path = writeRequirements(basePath, draft);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Board persistence ──

// Maps a cards workflow state to the board status it represents. The op runs
// from the states where the card's lifecycle position changes; it upserts the
// card (preserving its original createdAt) so the board reflects the workflow.
const BOARD_STATUS_BY_STATE: Record<string, BoardCardStatus> = {
  ready: "ready",
  in_progress: "in_progress",
  running_agent: "in_progress",
  validating: "in_progress",
  reviewing: "reviewing",
  running_review: "reviewing",
  reviewed: "reviewing",
  done: "done",
  unfulfillable: "unfulfillable",
};

function syncCardStatusOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const basePath = resolveBasePath(ctx);
    const status = BOARD_STATUS_BY_STATE[ctx.currentState];
    if (!status) {
      return { ok: true, skipped: true };
    }
    const spec = readCardSpec(ctx);
    upsertCard(basePath, {
      id: ctx.instanceId,
      title: spec.title,
      description: spec.description,
      acceptanceCriteria: spec.acceptanceCriteria,
      status,
      dependsOn: spec.dependsOn,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, status, cardId: ctx.instanceId };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function syncIdeaOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const basePath = resolveBasePath(ctx);
    const state = ctx.workflowInstanceState();
    const title =
      typeof state.title === "string" ? state.title : ctx.instanceId;
    const brief = typeof state.brief === "string" ? state.brief : "";
    const status = ideaStatusForState(ctx.currentState);
    upsertIdea(basePath, {
      id: ctx.instanceId,
      title,
      brief,
      status,
    });
    return { ok: true, ideaId: ctx.instanceId };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function ideaStatusForState(state: string): "backlog" | "refined" | "archived" {
  if (state === "archived") return "archived";
  if (state === "submitted" || state === "refined") return "refined";
  return "backlog";
}

// ── Completion gate ──

// Deterministic: the worker's feature branch exists and is ahead of hive-main
// (committed work). The worker commits with commit_work before submit_work.
function validateCompletionOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const basePath = resolveBasePath(ctx);
    const cardId = ctx.instanceId;
    const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
    const branchName = `hive/${cardId}/attempt-${attempt}`;
    const branchExists = gitOptional(basePath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    if (!branchExists) {
      return { ok: false, error: `No work branch ${branchName} found` };
    }
    const aheadRaw = gitOptional(basePath, [
      "rev-list",
      "--count",
      `hive-main..${branchName}`,
    ]);
    const commitCount = aheadRaw === "" ? 0 : Number(aheadRaw);
    if (commitCount < 1) {
      return {
        ok: false,
        error: `No committed work on ${branchName}`,
      };
    }
    recordCardEvent(basePath, cardId, {
      type: "completion_validated",
      at: new Date().toISOString(),
      data: { commitCount, branchName },
    });
    return { ok: true, commitCount, branchName };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Review package ──

function buildReviewPackageOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  try {
    const basePath = resolveBasePath(ctx);
    const cardId = ctx.instanceId;
    const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
    const branchName = `hive/${cardId}/attempt-${attempt}`;
    const packageId = randomUUID();
    const pkg = {
      packageId,
      cardId,
      attempt,
      spec: readCardSpec(ctx),
      requirements: readRequirements(basePath),
      baseCommit: gitOptional(basePath, ["rev-parse", "hive-main"]),
      workerHead: gitOptional(basePath, ["rev-parse", branchName]),
      diff: gitOptional(basePath, ["diff", "--stat", "hive-main", branchName]),
      createdAt: new Date().toISOString(),
    };
    const path = writeReviewPackage(basePath, pkg);
    recordCardEvent(basePath, cardId, {
      type: "review_package_built",
      at: new Date().toISOString(),
      data: { packageId },
    });
    return { ok: true, packageId, path };
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
    const basePath = typeof config.basePath === "string" ? config.basePath : "";
    const targetBranch =
      typeof config.targetBranch === "string" ? config.targetBranch : "main";
    return fastForwardTargetBranch(task, { basePath, targetBranch });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ── Operation exports ──

export const queenBeeOperations: Record<string, OperationFn> = {
  validate_repo: validateRepo,
  ensure_integration_branch: ensureIntegrationBranchOp,
  write_project_metadata: writeProjectMetadata,
  finalize_requirements: finalizeRequirementsOp,
  sync_card_status: syncCardStatusOp,
  sync_idea: syncIdeaOp,
  validate_completion: validateCompletionOp,
  build_review_package: buildReviewPackageOp,
  fast_forward_target_branch: fastForwardTargetBranchOp,
};

// ── Git helpers ──

type OperationResult = Record<string, unknown>;

function readBasePath(ctx: OperationContext): string {
  const raw = ctx.flowConfig().basePath;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Flow config basePath is not set");
  }
  return raw;
}

function resolveBasePath(ctx: OperationContext): string {
  const basePath = readBasePath(ctx);
  return basePath.startsWith("/") ? basePath : join(process.cwd(), basePath);
}

function validateGitRepo(basePath: string): void {
  const stat = statSync(join(basePath, ".git"));
  if (!stat.isDirectory()) {
    throw new Error(`Not a git repository: ${basePath}`);
  }
}

function ensureRepoInitialized(basePath: string): void {
  try {
    execSync("git rev-parse HEAD", {
      cwd: basePath,
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
      join(basePath, "README.md"),
      `# ${basePath.split("/").pop()}\n`
    );
    execSync("git add -A", {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    execSync('git commit -m "Initial commit"', {
      cwd: basePath,
      encoding: "utf-8",
      timeout: 5_000,
    });
  } catch {
    try {
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: basePath,
        encoding: "utf-8",
        timeout: 5_000,
      });
    } catch {
      // ignore
    }
  }
}

function inferTargetBranch(basePath: string): string {
  const current = gitOptional(basePath, ["branch", "--show-current"]);
  if (current && current !== "hive-main") return current;

  const branches = gitOptional(basePath, [
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

function gitOptional(basePath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: basePath,
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// The card spec lives in the cards workflow instance state (workflowInstanceState.cardSpec)
// when the planning proposal carried one; otherwise a minimal fallback keeps the
// board and review package well-formed.
function readCardSpec(ctx: OperationContext): CardSpec {
  const raw = ctx.workflowInstanceState().cardSpec;
  if (raw !== null && typeof raw === "object") {
    const spec = raw as Partial<CardSpec>;
    return {
      title: typeof spec.title === "string" ? spec.title : ctx.instanceId,
      description: typeof spec.description === "string" ? spec.description : "",
      acceptanceCriteria: readStringArray(spec.acceptanceCriteria),
      dependsOn: readStringArray(spec.dependsOn),
    };
  }
  return {
    title: ctx.instanceId,
    description: "",
    acceptanceCriteria: [],
    dependsOn: [],
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
