/** @private — only imported by worker-supervisor.ts */

import { execFileSync } from "node:child_process";
import type { ToolCall } from "../devise-engine/devise-tools";
import {
  buildVerificationEvidence,
  type WorkerCompletion,
  type WorkerToolEvidence,
} from "../worker-completion";

export type CompletionGateResult =
  | { ok: true; completion: WorkerCompletion }
  | { ok: false; correction: string };

export function evaluateCompletion(
  toolCall: ToolCall,
  workspacePath: string,
  baseCommit: string,
  evidence: ReadonlyMap<string, WorkerToolEvidence>
): CompletionGateResult {
  const completion = parseCompletion(toolCall);
  if (!completion) {
    return rejected(
      "submit_work arguments are invalid. Set outcome to implemented or already_satisfied and provide verification evidence or a reason it was not run."
    );
  }

  if (git(workspacePath, ["status", "--porcelain"])) {
    return rejected(
      "the worktree has uncommitted changes. Inspect git_status, create meaningful commits with commit_work, rerun verification, then submit again."
    );
  }

  const headCommit = git(workspacePath, ["rev-parse", "HEAD"]);
  const commitsAhead = Number(
    git(workspacePath, ["rev-list", "--count", `${baseCommit}..HEAD`])
  );
  if (completion.outcome === "implemented" && commitsAhead === 0) {
    return rejected(
      "implemented work requires at least one Worker Agent commit ahead of the recorded base. Use commit_work before submitting."
    );
  }
  if (completion.outcome === "already_satisfied" && commitsAhead !== 0) {
    return rejected(
      "already_satisfied requires a zero-diff branch with no commits ahead of the recorded base. Submit implemented work instead."
    );
  }

  const changedFiles = gitLines(workspacePath, [
    "diff",
    "--name-only",
    `${baseCommit}...HEAD`,
  ]);
  if (changedFiles.includes(".hive/requirements.md")) {
    return rejected(
      ".hive/requirements.md is protected project-wide state. Revert that Worker Agent change; requirements may only change through an approved Requirements workflow."
    );
  }

  const verificationFailure = validateVerification(
    completion,
    evidence,
    headCommit
  );
  if (verificationFailure) return rejected(verificationFailure);
  if (
    completion.outcome === "already_satisfied" &&
    !completion.noChangeRationale
  ) {
    return rejected(
      "already_satisfied requires a noChangeRationale for independent review."
    );
  }

  return {
    ok: true,
    completion: {
      ...completion,
      verificationEvidence: buildVerificationEvidence(completion, evidence),
    },
  };
}

function parseCompletion(
  toolCall: ToolCall
): Omit<WorkerCompletion, "verificationEvidence"> | null {
  const parsed: unknown = JSON.parse(toolCall.arguments);
  if (!isRecord(parsed)) return null;
  if (
    parsed.outcome !== "implemented" &&
    parsed.outcome !== "already_satisfied"
  ) {
    return null;
  }
  const verificationCallIds = stringArray(parsed.verificationCallIds);
  if (!verificationCallIds) return null;
  const verificationNotRunReason = optionalNonEmptyString(
    parsed.verificationNotRunReason
  );
  const noChangeRationale = optionalNonEmptyString(parsed.noChangeRationale);
  return {
    outcome: parsed.outcome,
    verificationCallIds,
    ...(verificationNotRunReason ? { verificationNotRunReason } : {}),
    ...(noChangeRationale ? { noChangeRationale } : {}),
  };
}

function validateVerification(
  completion: Omit<WorkerCompletion, "verificationEvidence">,
  evidence: ReadonlyMap<string, WorkerToolEvidence>,
  headCommit: string
): string | null {
  const hasCalls = completion.verificationCallIds.length > 0;
  const hasReason = Boolean(completion.verificationNotRunReason);
  if (hasCalls === hasReason) {
    return "provide either verificationCallIds or verificationNotRunReason, but not both.";
  }
  if (!hasCalls) return null;

  for (const callId of completion.verificationCallIds) {
    const result = evidence.get(callId);
    if (result?.name !== "run_command") {
      return `verificationCallIds contains '${callId}', which is not a recorded run_command result.`;
    }
    if (result.isError) {
      return `verification command '${callId}' failed. Correct the failure and run verification again.`;
    }
    if (result.headCommit !== headCommit) {
      return `verification command '${callId}' ran before the current commit. Rerun it against HEAD and submit the new call ID.`;
    }
  }
  return null;
}

function rejected(reason: string): CompletionGateResult {
  return { ok: false, correction: `Completion rejected: ${reason}` };
}

function git(workspacePath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspacePath,
    encoding: "utf-8",
    timeout: 5_000,
  }).trim();
}

function gitLines(workspacePath: string, args: string[]): string[] {
  return git(workspacePath, args).split("\n").filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}
