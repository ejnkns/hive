import type {
  PlanningChange,
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";

export function parsePlanningProposalResponse(value: unknown): {
  proposal?: PlanningProposal;
  feedback?: RequirementsFeedback;
  error?: string;
} {
  if (!isRecord(value)) return {};
  return {
    ...(isPlanningProposal(value.proposal) ? { proposal: value.proposal } : {}),
    ...(isRequirementsFeedback(value.feedback)
      ? { feedback: value.feedback }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function isPlanningProposal(value: unknown): value is PlanningProposal {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (value.status === "pending" ||
      value.status === "applied" ||
      value.status === "cancelled") &&
    typeof value.baseRequirementsRevision === "string" &&
    typeof value.baseBoardRevision === "string" &&
    (typeof value.projectRevision === "string" ||
      value.projectRevision === null) &&
    isPlanningRunKind(value.runKind) &&
    typeof value.proposedRequirements === "string" &&
    Array.isArray(value.changes) &&
    value.changes.every(isPlanningChange) &&
    typeof value.createdAt === "string"
  );
}

function isRequirementsFeedback(value: unknown): value is RequirementsFeedback {
  return (
    isRecord(value) &&
    value.kind === "requirements_feedback" &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    ["pending", "repairing", "resolved"].includes(String(value.status)) &&
    (typeof value.projectRevision === "string" ||
      value.projectRevision === null) &&
    typeof value.baseRequirementsRevision === "string" &&
    typeof value.baseBoardRevision === "string" &&
    typeof value.proposedRequirements === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        isRecord(issue) &&
        Array.isArray(issue.requirementRefs) &&
        typeof issue.category === "string" &&
        typeof issue.explanation === "string" &&
        Array.isArray(issue.evidence) &&
        typeof issue.decisionNeeded === "string" &&
        typeof issue.recommendation === "string"
    )
  );
}

function isPlanningRunKind(value: unknown): boolean {
  return [
    "initial_planning",
    "requirements_reconciliation",
    "idea_resolution",
    "card_replanning",
  ].includes(String(value));
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
