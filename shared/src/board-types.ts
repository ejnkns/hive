/** @public */

export type Column =
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

export const COLUMN_LABELS: Record<Column, string> = {
  ready: "Ready",
  in_progress: "In Progress",
  reviewing: "Reviewing",
  done: "Done",
  unfulfillable: "Unfulfillable",
};

export type WorkerLog = {
  startedAt: string;
  finishedAt: string;
  iterations: number;
  toolCalls: { name: string; args: string }[];
  error?: string;
  content: string;
};

export type ReviewerLog = {
  status: "complete" | "error";
  verdict?: "approved" | "changes_requested";
  findings?: Array<{
    severity: "blocking" | "warning";
    requirement: string;
    evidence: string;
    recommendation: string;
  }>;
  verificationAssessment?: {
    status: "sufficient" | "insufficient";
    notes: string;
  };
  reviewPackageId?: string;
  error?: string;
  reviewedAt: string;
};

export type WorkAttempt = {
  attempt: number;
  branchName: string;
  worktreePath: string;
  baseCommit: string;
  status:
    | "working"
    | "worker_error"
    | "reviewed"
    | "review_error"
    | "changes_requested"
    | "accepted";
  startedAt: string;
  reviewedHead?: string;
  reviewedIntegrationRevision?: string;
  reviewPackageId?: string;
  decision?: {
    type: "accept" | "request_changes";
    guidance?: string;
    decidedAt: string;
  };
};

export type ActivityActor =
  | "supervisor"
  | "worker"
  | "reviewer"
  | "requirements"
  | "planner"
  | "user";

export type CardActivityEvent = {
  id: string;
  actor: ActivityActor;
  type: "status" | "tool" | "progress" | "decision" | "error";
  summary: string;
  detail?: string;
  occurredAt: string;
};

export type WorkerAdmissionBlocker = {
  kind: "capacity" | "dependency" | "file_overlap";
  message: string;
  cardIds: string[];
  files?: string[];
};

export type WorkerAdmission = {
  allowed: boolean;
  canOverride: boolean;
  activeWorkers: number;
  maxConcurrentWorkers: number;
  blockers: WorkerAdmissionBlocker[];
};

export type ReviewReadiness = {
  state:
    | "current"
    | "stale"
    | "conflicted"
    | "branch_changed"
    | "dirty"
    | "error";
  integrationRevision: string;
  reviewedIntegrationRevision: string;
  branchHead: string;
  reviewedHead: string;
  canAccept: boolean;
  canRefreshReview: boolean;
  conflictingFiles: string[];
  message: string;
};

export type CardSpecification = Pick<
  Card,
  | "title"
  | "description"
  | "acceptanceCriteria"
  | "relevantFiles"
  | "dependencies"
  | "requirementRefs"
>;

export type Idea = {
  id: string;
  title: string;
  brief: string;
  createdAt: string;
  archivedAt?: string;
};

export type Board = {
  projectId: string;
  ideas: Idea[];
  cards: Card[];
};

export type PlanningRunKind =
  | "initial_planning"
  | "requirements_reconciliation"
  | "idea_resolution"
  | "card_replanning";

export type RequirementsSessionKind =
  | "initial_requirements"
  | "requirements_revision"
  | "idea_elaboration"
  | "requirements_repair";

export type RequirementsFeedback = {
  kind: "requirements_feedback";
  id: string;
  projectId: string;
  status: "pending" | "repairing" | "resolved";
  projectRevision: string | null;
  baseRequirementsRevision: string;
  baseBoardRevision: string;
  proposedRequirements: string;
  sourceIdeaId?: string;
  createdAt: string;
  resolvedAt?: string;
  issues: Array<{
    requirementRefs: string[];
    category:
      | "contradiction"
      | "missing_decision"
      | "unobservable_acceptance"
      | "constraint_conflict"
      | "scope_loss"
      | "insufficient_detail";
    explanation: string;
    evidence: string[];
    decisionNeeded: string;
    recommendation: string;
  }>;
};

export type PlanningOutcome = PlanningProposal | RequirementsFeedback;

export type PlanningChange = {
  id: string;
  action: "keep" | "create" | "update" | "remove";
  cardId?: string;
  proposedCard?: CardSpecification;
  rationale: string;
  decision: "pending" | "accepted" | "rejected";
  resolvesSourceIdea?: boolean;
  targetColumn?: "ready";
};

export type PlanningProposal = {
  id: string;
  projectId: string;
  status: "pending" | "applied" | "cancelled";
  baseRequirementsRevision: string;
  baseBoardRevision: string;
  projectRevision: string | null;
  runKind: PlanningRunKind;
  sourceIdeaId?: string;
  proposedRequirements: string;
  changes: PlanningChange[];
  createdAt: string;
  appliedAt?: string;
};

export type WorkerHandover = {
  problem: string;
  attempted: string[];
  blockedBy: string[];
  occurredAt: string;
};

export type CoordinatorAction = "retry_with_patch" | "redevise" | "archive";

export type CoordinatorSuggestion = {
  id: string;
  action: CoordinatorAction;
  rationale: string;
  cardPatch?: {
    description?: string;
    acceptanceCriteria?: string[];
    relevantFiles?: string[];
    requirementRefs?: string[];
  };
  requirementsContent?: string;
};

export type CoordinatorLog = {
  status: "pending" | "complete" | "error";
  analyzedAt?: string;
  requirementsRevision?: string;
  summary?: string;
  suggestions?: CoordinatorSuggestion[];
  error?: string;
};

export type Card = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
  dependencies: string[];
  column: Column;
  createdAt: string;
  workerLog?: WorkerLog;
  reviewerLog?: ReviewerLog;
  handover?: WorkerHandover;
  coordinatorLog?: CoordinatorLog;
  requirementRefs?: string[];
  originIdeaIds?: string[];
  workAttempts?: WorkAttempt[];
  archivedAt?: string;
};

export function isWorkerAdmission(value: unknown): value is WorkerAdmission {
  if (!isRecord(value) || !Array.isArray(value.blockers)) return false;
  return (
    typeof value.allowed === "boolean" &&
    typeof value.canOverride === "boolean" &&
    typeof value.activeWorkers === "number" &&
    typeof value.maxConcurrentWorkers === "number" &&
    value.blockers.every(
      (blocker) =>
        isRecord(blocker) &&
        (blocker.kind === "capacity" ||
          blocker.kind === "dependency" ||
          blocker.kind === "file_overlap") &&
        typeof blocker.message === "string" &&
        Array.isArray(blocker.cardIds) &&
        blocker.cardIds.every((cardId) => typeof cardId === "string")
    )
  );
}

export function isReviewReadiness(value: unknown): value is ReviewReadiness {
  if (!isRecord(value)) return false;
  return (
    isReviewReadinessState(value.state) &&
    typeof value.integrationRevision === "string" &&
    typeof value.reviewedIntegrationRevision === "string" &&
    typeof value.branchHead === "string" &&
    typeof value.reviewedHead === "string" &&
    typeof value.canAccept === "boolean" &&
    typeof value.canRefreshReview === "boolean" &&
    Array.isArray(value.conflictingFiles) &&
    value.conflictingFiles.every((file) => typeof file === "string") &&
    typeof value.message === "string"
  );
}

function isReviewReadinessState(
  value: unknown
): value is ReviewReadiness["state"] {
  return (
    value === "current" ||
    value === "stale" ||
    value === "conflicted" ||
    value === "branch_changed" ||
    value === "dirty" ||
    value === "error"
  );
}

export function isPlanningRunKind(value: unknown): value is PlanningRunKind {
  return [
    "initial_planning",
    "requirements_reconciliation",
    "idea_resolution",
    "card_replanning",
  ].includes(String(value));
}

export function isPlanningChange(value: unknown): value is PlanningChange {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["keep", "create", "update", "remove"].includes(String(value.action)) &&
    typeof value.rationale === "string" &&
    ["pending", "accepted", "rejected"].includes(String(value.decision))
  );
}

export function isPlanningProposal(value: unknown): value is PlanningProposal {
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

export function isRequirementsFeedback(
  value: unknown
): value is RequirementsFeedback {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
