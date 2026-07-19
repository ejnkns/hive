/** @private — only imported by kanban-board.svelte */

import { isReviewReadiness, type ReviewReadiness } from "shared/board-types";

export function parseReviewReadinessResponse(
  value: unknown
): { readiness: ReviewReadiness } | Record<string, never> {
  if (!isRecord(value) || !isReviewReadiness(value.readiness)) return {};
  return { readiness: value.readiness };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
