// The cards workflow's check_review_freshness operation, referenced by the
// queen-bee blueprint.

import {
  defineOperations,
  gitOptional,
  type OperationContext,
  readFlowSettings,
  readPersistedOutput,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { CardsState } from "../types.ts";

type OperationResult = Record<string, unknown>;

// Deterministic stale-review guard. The review package records the integration
// head it was built against; if the live integration branch has moved since,
// accepting would merge stale-reviewed work. Reads the persisted package (fs
// READ only — ops still never write files), patches reviewIsStale into the
// instance state, and gates read that flag. Throws on logical failure.
function checkReviewFreshnessOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<CardsState>
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export const check_review_freshnessOperations = defineOperations<CardsState>({
  check_review_freshness: checkReviewFreshnessOp,
});
