/** @private — only imported by worker-supervisor.ts */

import type { Message } from "shared/message";
import type { Card } from "../board-store";
import { WORKER_SYSTEM_PROMPT } from "./worker-system-prompt";

export function buildWorkerContext(
  card: Card,
  systemPrompt: string,
  codingGuidelines: string
): Message[] {
  const messages: Message[] = [];

  messages.push({ role: "system", content: WORKER_SYSTEM_PROMPT });

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  if (codingGuidelines) {
    messages.push({ role: "system", content: codingGuidelines });
  }

  const taskPrompt = buildTaskPrompt(card);
  messages.push({ role: "user", content: taskPrompt });

  return messages;
}

function buildTaskPrompt(card: Card): string {
  const parts: string[] = [];

  parts.push(`## Task: ${card.title}`);
  parts.push("");

  if (card.description) {
    parts.push(card.description);
    parts.push("");
  }

  if (card.acceptanceCriteria.length > 0) {
    parts.push("### Acceptance Criteria");
    for (const criterion of card.acceptanceCriteria) {
      parts.push(`- [ ] ${criterion}`);
    }
    parts.push("");
  }

  if (card.relevantFiles.length > 0) {
    parts.push("### Relevant Files");
    for (const file of card.relevantFiles) {
      parts.push(`- ${file}`);
    }
    parts.push("");
  }

  if (card.dependencies.length > 0) {
    parts.push("### Dependencies");
    parts.push("The following cards must be completed before this task:");
    for (const dep of card.dependencies) {
      parts.push(`- ${dep}`);
    }
    parts.push("");
  }

  if (card.reviewerLog && card.reviewerLog.verdict === "fail") {
    parts.push("### Previous Review Feedback");
    parts.push(
      "The previous attempt at this task failed review. Address this feedback:"
    );
    parts.push(card.reviewerLog.feedback);
    parts.push("");
  }

  parts.push("### Instructions");
  parts.push(
    "Implement this task. Read the relevant files first, create meaningful commits with commit_work, verify the final commit, and finish with submit_work."
  );

  return parts.join("\n");
}
