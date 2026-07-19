/** @public */

export type WorkerCompletion = {
  outcome: "implemented" | "already_satisfied";
  verificationCallIds: string[];
  verificationNotRunReason?: string;
  noChangeRationale?: string;
  verificationEvidence: Array<{
    callId: string;
    command: string;
    output: string;
    headCommit: string;
  }>;
};

export type WorkerToolEvidence = {
  name: string;
  arguments: string;
  output: string;
  isError: boolean;
  headCommit: string;
};
