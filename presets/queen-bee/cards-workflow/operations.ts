// Cards workflow internals; import via cards-workflow.ts.

import { randomUUID } from "node:crypto";
import {
  gitOptional,
  type OperationContext,
  readFlowSettings,
  readPersistedOutput,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type {
  CardSpec,
  CardsItemState,
  ReviewPackage,
} from "../cards-workflow.ts";

// The cards workflow's operations, keyed by the names its tasks reference.
// flow.ts binds the state type (defineOperations<CardsItemState>) and merges
// this into the preset's registry.
export const cardsOperations = {
  build_review_package: buildReviewPackageOp,
  check_review_freshness: checkReviewFreshnessOp,
};

type OperationResult = Record<string, unknown>;

function buildReviewPackageOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<CardsItemState>
): ReviewPackage {
  const basePath = resolveBasePath(ctx.flowConfig());
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
    spec: readCardSpec(ctx.workflowInstanceState(), cardId),
    requirements: readPersistedOutput(ctx.flowConfig(), "requirements.md"),
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
  ctx: OperationContext<CardsItemState>
): OperationResult {
  const basePath = resolveBasePath(ctx.flowConfig());
  const cardId = ctx.instanceId;
  const attempt = readNumber(ctx.workflowInstanceState().attempt) ?? 1;
  const { integrationBranch } = readFlowSettings(ctx.flowConfig());
  if (!integrationBranch) {
    throw new Error("Flow config integrationBranch is required");
  }
  const raw = readPersistedOutput(
    ctx.flowConfig(),
    "reviews/{instanceId}-{attempt}.json",
    {
      instanceId: cardId,
      attempt,
    }
  );
  if (raw === "") {
    throw new Error(`No review package for card ${cardId} attempt ${attempt}`);
  }
  const pkg = JSON.parse(raw) as { baseCommit?: string };
  if (typeof pkg.baseCommit !== "string" || pkg.baseCommit === "") {
    throw new Error(`Review package for card ${cardId} has no baseCommit`);
  }
  const liveHead = gitOptional(basePath, ["rev-parse", integrationBranch]);
  if (liveHead === "") {
    throw new Error(`Integration branch ${integrationBranch} not found`);
  }
  const reviewIsStale = pkg.baseCommit !== liveHead;
  ctx.patchWorkflowInstanceState({ reviewIsStale });
  return { ok: true, reviewIsStale };
}

function readCardSpec(state: CardsItemState, fallbackTitle: string): CardSpec {
  const raw = state.cardSpec;
  if (raw !== null && typeof raw === "object") {
    return {
      title: typeof raw.title === "string" ? raw.title : fallbackTitle,
      description: typeof raw.description === "string" ? raw.description : "",
      acceptanceCriteria: readStringArray(raw.acceptanceCriteria),
      dependsOn: readStringArray(raw.dependsOn),
    };
  }
  return {
    title: fallbackTitle,
    description: "",
    acceptanceCriteria: [],
    dependsOn: [],
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
