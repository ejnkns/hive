import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationContext, OperationFn } from "workflow-engine/runners";
import {
  ensureIntegrationBranch,
  fastForwardTargetBranch,
  readFlowSettings,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { CardSpec, ReviewPackage } from "./domain-state";

// === QUEEN BEE DOMAIN OPERATIONS ===
//
// Deterministic operations referenced by name in queen-bee workflow tasks.
// Infrastructure operations (prepare_worktree, patch_flow_config,
// commit_flow_state, validate_repo) ship in the engine; these are
// queen-bee-specific and belong to the preset. The engine invokes them without
// interpreting what they mean.
//
// Operations return DATA and never write files: task outputs become persisted
// state (persist + commit_flow_state) and the board is derived from instance
// state. An operation throws on logical failure so the task errors and gates
// inspect taskOutputs.<task>.status.

// ── Onboarding operations ──

function ensureIntegrationBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const basePath = resolveBasePath(ctx);
  const { integrationBranch, branchPrefix } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!integrationBranch || !branchPrefix) {
    throw new Error(
      "Flow config integrationBranch and branchPrefix are required"
    );
  }
  const result = ensureIntegrationBranch(task, { basePath }, ctx);
  const targetBranch = inferTargetBranch(
    basePath,
    integrationBranch,
    branchPrefix
  );
  ctx.patchFlowConfig({ basePath, targetBranch });
  return { ...result, targetBranch };
}

function writeProjectMetadata(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const config = ctx.flowConfig();
  const basePath = resolveBasePath(ctx);
  const name =
    typeof config.name === "string"
      ? config.name
      : (basePath.split("/").pop() ?? basePath);
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return { name, basePath, targetBranch };
}

// ── Requirements persistence ──

// The requirements draft is the requirements session's running output, recorded
// in the instance state by the update_requirements_draft tool. Finalizing
// returns the text; the task persists it as requirements.md.
function finalizeRequirementsOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): string {
  const raw = ctx.workflowInstanceState().requirementsDraft;
  const draft = typeof raw === "string" ? raw : "";
  if (draft === "") {
    throw new Error("No requirements draft to finalize");
  }
  return draft;
}

// ── Completion gate ──

// Deterministic: the worker's feature branch exists and is ahead of the
// integration branch (committed work). The worker commits with commit_work
// before submit_work.
function validateCompletionOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const basePath = resolveBasePath(ctx);
  const cardId = ctx.instanceId;
  const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
  const { branchPrefix, integrationBranch } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!branchPrefix || !integrationBranch) {
    throw new Error(
      "Flow config branchPrefix and integrationBranch are required"
    );
  }
  const branchName = `${branchPrefix}${cardId}/attempt-${attempt}`;
  const branchExists = gitOptional(basePath, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);
  if (!branchExists) {
    throw new Error(`No work branch ${branchName} found`);
  }
  const aheadRaw = gitOptional(basePath, [
    "rev-list",
    "--count",
    `${integrationBranch}..${branchName}`,
  ]);
  const commitCount = aheadRaw === "" ? 0 : Number(aheadRaw);
  if (commitCount < 1) {
    throw new Error(`No committed work on ${branchName}`);
  }
  return { ok: true, commitCount, branchName };
}

// ── Review package ──

function buildReviewPackageOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): ReviewPackage {
  const basePath = resolveBasePath(ctx);
  const cardId = ctx.instanceId;
  const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
  const { branchPrefix, integrationBranch, domainDir } = readFlowSettings(
    ctx.flowConfig()
  );
  if (!branchPrefix || !integrationBranch || !domainDir) {
    throw new Error(
      "Flow config branchPrefix, integrationBranch, and domainDir are required"
    );
  }
  const branchName = `${branchPrefix}${cardId}/attempt-${attempt}`;
  return {
    packageId: randomUUID(),
    cardId,
    attempt,
    spec: readCardSpec(ctx),
    requirements: readFileSafe(join(basePath, domainDir, "requirements.md")),
    baseCommit: gitOptional(basePath, ["rev-parse", integrationBranch]),
    workerHead: gitOptional(basePath, ["rev-parse", branchName]),
    diff: gitOptional(basePath, [
      "diff",
      "--stat",
      integrationBranch,
      branchName,
    ]),
    createdAt: new Date().toISOString(),
  };
}

// ── Integration operation ──

function fastForwardTargetBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const config = ctx.flowConfig();
  const basePath = typeof config.basePath === "string" ? config.basePath : "";
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return fastForwardTargetBranch(task, { basePath, targetBranch }, ctx);
}

// ── Review freshness ──

// Deterministic stale-review guard. The review package records the integration
// head it was built against; if the live integration branch has moved since,
// accepting would merge stale-reviewed work. Reads the persisted package (fs
// READ only — ops still never write files), patches reviewIsStale into the
// instance state, and gates read that flag. Throws on logical failure.
function checkReviewFreshnessOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): OperationResult {
  const basePath = resolveBasePath(ctx);
  const cardId = ctx.instanceId;
  const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
  const { integrationBranch, domainDir } = readFlowSettings(ctx.flowConfig());
  if (!integrationBranch || !domainDir) {
    throw new Error("Flow config integrationBranch and domainDir are required");
  }
  const packagePath = join(
    basePath,
    domainDir,
    "reviews",
    `${cardId}-${attempt}.json`
  );
  const raw = readFileSafe(packagePath);
  if (raw === "") {
    throw new Error(`No review package at ${packagePath}`);
  }
  const pkg = JSON.parse(raw) as { baseCommit?: string };
  if (typeof pkg.baseCommit !== "string" || pkg.baseCommit === "") {
    throw new Error(`Review package ${packagePath} has no baseCommit`);
  }
  const liveHead = gitOptional(basePath, ["rev-parse", integrationBranch]);
  if (liveHead === "") {
    throw new Error(`Integration branch ${integrationBranch} not found`);
  }
  const reviewIsStale = pkg.baseCommit !== liveHead;
  ctx.patchWorkflowInstanceState({ reviewIsStale });
  return { ok: true, reviewIsStale };
}

// ── Operation exports ──

export const queenBeeOperations: Record<string, OperationFn> = {
  ensure_integration_branch: ensureIntegrationBranchOp,
  write_project_metadata: writeProjectMetadata,
  finalize_requirements: finalizeRequirementsOp,
  validate_completion: validateCompletionOp,
  build_review_package: buildReviewPackageOp,
  check_review_freshness: checkReviewFreshnessOp,
  fast_forward_target_branch: fastForwardTargetBranchOp,
};

// ── Helpers ──

type OperationResult = Record<string, unknown>;

function resolveBasePath(ctx: OperationContext): string {
  const raw = ctx.flowConfig().basePath;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Flow config basePath is not set");
  }
  return raw.startsWith("/") ? raw : join(process.cwd(), raw);
}

// The user's development branch, excluding the queen-bee integration branch and
// its feature-branch prefix. Falls back to main/master or the most recent other
// branch.
function inferTargetBranch(
  basePath: string,
  integrationBranch: string,
  branchPrefix: string
): string {
  const isProjectBranch = (branch: string): boolean =>
    branch === integrationBranch || branch.startsWith(branchPrefix);
  const current = gitOptional(basePath, ["branch", "--show-current"]);
  if (current && !isProjectBranch(current)) return current;

  const branches = gitOptional(basePath, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter((branch) => branch && !isProjectBranch(branch));
  const preferred =
    branches.find((branch) => branch === "main") ??
    branches.find((branch) => branch === "master") ??
    branches[0];
  if (!preferred) {
    throw new Error("Project requires a target branch for Hive integration");
  }
  return preferred;
}

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

function readFileSafe(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
