/** @public */

import type { Message } from "shared/message";
import {
  type AgentModelCaller,
  createAgentModelCaller,
} from "./devise-engine/create-devise-model-caller";
import type { ToolCall } from "./devise-engine/devise-tools";
import { REVIEWER_SYSTEM_PROMPT } from "./reviewer/reviewer-system-prompt";
import { executeReviewerTool, REVIEWER_TOOLS } from "./reviewer/reviewer-tools";

export { REVIEWER_TOOLS } from "./reviewer/reviewer-tools";

export type ReviewPackage = {
  id: string;
  card: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    requirementRefs: string[];
  };
  requirements: { revision: string; content: string };
  revisions: {
    baseCommit: string;
    headCommit: string;
    reviewCommit: string;
    reviewReference?: string;
    integrationCommit: string;
    cardRevision: string;
  };
  commits: Array<{ sha: string; subject: string }>;
  changedFiles: string[];
  diff: string;
  diffStat: string;
  verification: {
    commands: Array<{
      callId: string;
      command: string;
      output: string;
      headCommit: string;
    }>;
    notRunReason?: string;
  };
  noChangeRationale?: string;
};

export type ReviewerFinding = {
  severity: "blocking" | "warning";
  requirement: string;
  evidence: string;
  recommendation: string;
};

export type ReviewerVerdict = {
  verdict: "approved" | "changes_requested";
  findings: ReviewerFinding[];
  verificationAssessment: {
    status: "sufficient" | "insufficient";
    notes: string;
  };
};

export type Reviewer = {
  review(
    reviewPackage: ReviewPackage,
    worktreePath: string
  ): Promise<ReviewerVerdict>;
};

export function createReviewer(
  modelCaller: AgentModelCaller = createAgentModelCaller(REVIEWER_TOOLS)
): Reviewer {
  return {
    async review(reviewPackage, worktreePath): Promise<ReviewerVerdict> {
      const messages: Message[] = [
        { role: "system", content: REVIEWER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Review this immutable Review Package:\n\n${JSON.stringify(reviewPackage, null, 2)}`,
        },
      ];
      let invalidSubmissions = 0;

      for (let iteration = 0; iteration < 20; iteration++) {
        const response = await modelCaller.call(messages, worktreePath, true);
        const submission = response.toolCalls.find(
          (toolCall) => toolCall.name === "submit_review"
        );
        if (submission) {
          const verdict =
            response.toolCalls.length === 1
              ? parseReviewSubmission(submission)
              : null;
          if (verdict) return verdict;
          invalidSubmissions += 1;
          if (invalidSubmissions >= 2) {
            throw new Error(
              "Reviewer Agent failed to submit a valid structured review"
            );
          }
          appendToolExchange(
            messages,
            response.content,
            submission,
            "Review rejected: submit_review must be the only tool call and must match the required schema."
          );
          continue;
        }

        if (response.toolCalls.length === 0) {
          invalidSubmissions += 1;
          if (invalidSubmissions >= 2) {
            throw new Error(
              "Reviewer Agent failed to submit a valid structured review"
            );
          }
          messages.push({
            role: "system",
            content:
              "Review rejected: finish by calling submit_review as the only tool call.",
          });
          continue;
        }

        for (const toolCall of response.toolCalls) {
          const result = executeReviewerTool(
            toolCall,
            worktreePath,
            reviewPackage.revisions.baseCommit
          );
          appendToolExchange(
            messages,
            response.content,
            toolCall,
            result.content
          );
        }
      }

      throw new Error("Reviewer Agent reached the maximum iteration limit");
    },
  };
}

function parseReviewSubmission(toolCall: ToolCall): ReviewerVerdict | null {
  const parsed: unknown = JSON.parse(toolCall.arguments);
  if (!isRecord(parsed)) return null;
  if (parsed.verdict !== "approved" && parsed.verdict !== "changes_requested") {
    return null;
  }
  const findings = parseFindings(parsed.findings);
  const assessment = parseVerificationAssessment(parsed.verificationAssessment);
  if (!findings || !assessment) return null;
  return {
    verdict: parsed.verdict,
    findings,
    verificationAssessment: assessment,
  };
}

function parseFindings(value: unknown): ReviewerFinding[] | null {
  if (!Array.isArray(value)) return null;
  const findings: ReviewerFinding[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (item.severity !== "blocking" && item.severity !== "warning") {
      return null;
    }
    if (
      typeof item.requirement !== "string" ||
      typeof item.evidence !== "string" ||
      typeof item.recommendation !== "string"
    ) {
      return null;
    }
    findings.push({
      severity: item.severity,
      requirement: item.requirement,
      evidence: item.evidence,
      recommendation: item.recommendation,
    });
  }
  return findings;
}

function parseVerificationAssessment(
  value: unknown
): ReviewerVerdict["verificationAssessment"] | null {
  if (!isRecord(value)) return null;
  if (value.status !== "sufficient" && value.status !== "insufficient") {
    return null;
  }
  if (typeof value.notes !== "string") return null;
  return { status: value.status, notes: value.notes };
}

function appendToolExchange(
  messages: Message[],
  responseContent: string,
  toolCall: ToolCall,
  resultContent: string
): void {
  messages.push(
    {
      role: "assistant",
      content: responseContent,
      tool_calls: [
        {
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        },
      ],
    },
    { role: "tool", content: resultContent, tool_call_id: toolCall.id }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
