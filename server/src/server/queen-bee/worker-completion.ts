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

export function buildVerificationEvidence(
  completion: Pick<WorkerCompletion, "verificationCallIds">,
  evidence: ReadonlyMap<string, WorkerToolEvidence>
): WorkerCompletion["verificationEvidence"] {
  return completion.verificationCallIds.map((callId) => {
    const result = evidence.get(callId);
    if (!result) throw new Error(`Missing verified evidence: ${callId}`);
    return {
      callId,
      command: result.arguments,
      output: result.output,
      headCommit: result.headCommit,
    };
  });
}
