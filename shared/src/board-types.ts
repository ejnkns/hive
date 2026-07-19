/** @public */

export type Column =
  | "idea"
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

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
  | "devise"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CardSpecification = Pick<
  Card,
  | "title"
  | "description"
  | "acceptanceCriteria"
  | "relevantFiles"
  | "dependencies"
  | "requirementRefs"
>;

export type PlanningChange = {
  id: string;
  action: "keep" | "create" | "update" | "remove";
  cardId?: string;
  proposedCard?: CardSpecification;
  rationale: string;
  decision: "pending" | "accepted" | "rejected";
  targetColumn?: "ready";
};

export type PlanningProposal = {
  id: string;
  projectId: string;
  status: "pending" | "applied";
  baseRequirementsRevision: string;
  baseBoardRevision: string;
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
  workAttempts?: WorkAttempt[];
  archivedAt?: string;
};
