import type { PlanningChange, PlanningProposal } from "shared/board-types";

export function parsePlanningProposalResponse(value: unknown): {
  proposal?: PlanningProposal;
  error?: string;
} {
  if (!isRecord(value)) return {};
  return {
    ...(isPlanningProposal(value.proposal) ? { proposal: value.proposal } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function isPlanningProposal(value: unknown): value is PlanningProposal {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (value.status === "pending" || value.status === "applied") &&
    typeof value.baseRequirementsRevision === "string" &&
    typeof value.baseBoardRevision === "string" &&
    typeof value.proposedRequirements === "string" &&
    Array.isArray(value.changes) &&
    value.changes.every(isPlanningChange) &&
    typeof value.createdAt === "string"
  );
}

function isPlanningChange(value: unknown): value is PlanningChange {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["keep", "create", "update", "remove"].includes(String(value.action)) &&
    typeof value.rationale === "string" &&
    ["pending", "accepted", "rejected"].includes(String(value.decision))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
