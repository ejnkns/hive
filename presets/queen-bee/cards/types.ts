// The cards workflow's instance state type and domain types, self-contained
// for the referenced cards ops (they cannot import types from the rendered
// entry).

// The domain data a card instance carries (workflowInstanceState.cardSpec),
// authored by the requirements→cards edge from the accepted plan.
export type CardSpec = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
};

// The immutable review artifact built by build_review_package and persisted to
// reviews/{instanceId}-{attempt}.json under the domain root.
export type ReviewPackage = {
  packageId: string;
  cardId: string;
  attempt: number;
  spec: CardSpec;
  requirements: string;
  baseCommit: string;
  workerHead: string;
  diff: string;
  createdAt: string;
};

export type CardsState = {
  // Engine-provided: written by the newAttempt action flag; read by
  // prepare_worktree / merge_branch / {attempt} persist paths. Unwritten
  // counters default to attempt 1.
  attempt?: number;
  // Written by check_review_freshness; read by the accept gates.
  reviewIsStale?: boolean;
  worktreePath?: string;
  branchName?: string;
  cardSpec?: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    dependsOn: string[];
  };
  // Engine-read (the dependsOnState backstop resolves instance ids against
  // this); written by the requirements→cards edge from the accepted plan.
  dependsOn?: string[];
};
