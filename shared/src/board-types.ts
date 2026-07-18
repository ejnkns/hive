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
  verdict: "pass" | "fail";
  feedback: string;
  reviewedAt: string;
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
  archivedAt?: string;
  branchSummary?: string;
  prUrl?: string;
  prError?: string;
};
