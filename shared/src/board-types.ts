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
