/** @public */

import type { Card } from "./board-store";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { REVIEWER_SYSTEM_PROMPT } from "./reviewer/reviewer-system-prompt";

export type ReviewerVerdict = {
  verdict: "pass" | "fail";
  feedback: string;
};

export type Reviewer = {
  review(
    card: Card,
    diff: string,
    worktreePath: string
  ): Promise<ReviewerVerdict>;
};

export function createReviewer(): Reviewer {
  const modelCaller = createDeviseModelCaller();

  return {
    async review(card, diff): Promise<ReviewerVerdict> {
      const criteriaText = card.acceptanceCriteria
        .map((c: string, i: number) => `${i + 1}. ${c}`)
        .join("\n");

      const prompt = [
        `## Card Description\n${card.description || "No description"}`,
        `## Acceptance Criteria\n${criteriaText || "No criteria"}`,
        `## Git Diff\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``,
      ].join("\n\n");

      const messages = [
        { role: "system" as const, content: REVIEWER_SYSTEM_PROMPT },
        { role: "user" as const, content: prompt },
      ];

      const response = await modelCaller.call(messages, "", false);
      return parseVerdict(response.content);
    },
  };
}

function parseVerdict(content: string): ReviewerVerdict {
  const verdictMatch = content.match(/VERDICT:\s*(pass|fail)/i);
  const feedbackMatch = content.match(/FEEDBACK:\s*([\s\S]*?)(?:\n\n|$)/i);

  return {
    verdict: verdictMatch?.[1].toLowerCase() === "pass" ? "pass" : "fail",
    feedback: feedbackMatch?.[1]?.trim() ?? content.trim(),
  };
}
