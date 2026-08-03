// Cards workflow internals; import via cards-workflow.ts.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationContext, OperationFn } from "workflow-engine/runners";
import { readFlowSettings } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { CardSpec, ReviewPackage } from "../cards-workflow";
import { gitOptional, type OperationResult, resolveBasePath } from "../shared";

export const cardsOperations: Record<string, OperationFn> = {
  validate_completion: validateCompletionOp,
  build_review_package: buildReviewPackageOp,
  check_review_freshness: checkReviewFreshnessOp,
};

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
