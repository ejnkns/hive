/** @private — only imported by kanban-board.svelte */

import { isReviewReadiness, type ReviewReadiness } from "shared/board-types";
import { isRecord } from "../../check-record";

export function parseReviewReadinessResponse(
  value: unknown
): { readiness: ReviewReadiness } | Record<string, never> {
  if (!isRecord(value) || !isReviewReadiness(value.readiness)) return {};
  return { readiness: value.readiness };
}
