// The cards workflow's build_review_package operation, referenced by the
// queen-bee blueprint.

import { randomUUID } from "node:crypto";
import {
  defineOperations,
  gitOptional,
  type OperationContext,
  readFlowSettings,
  readPersistedOutput,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { CardSpec, CardsState, ReviewPackage } from "../types.ts";

function buildReviewPackageOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<CardsState>
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

function readCardSpec(state: CardsState, fallbackTitle: string): CardSpec {
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

export const build_review_packageOperations = defineOperations<CardsState>({
  build_review_package: buildReviewPackageOp,
});
