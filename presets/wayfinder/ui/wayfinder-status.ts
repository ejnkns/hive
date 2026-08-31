/** The wayfinder WorkflowItem status readers (module-set sibling of the
 * served flow component): the pure, defensive readers over the open wire
 * shapes that the card-family surfaces share — the table workbench, the Base
 * Camp, the fallback cards, and the detail drawer's model — plus the one
 * chat-behaviour signal, so every surface agrees on what the agent is doing.
 * Value-imported siblings of the served entry (the server serves the
 * module-set file tree to the browser with relative imports rewritten to
 * absolute versioned URLs). */

import type { ChatMessage } from "workflow-engine/workflow-types";

// The ticket resolution task ids. A ticket resolves through the research
// (ai-task) task or one of the four chat sessions; the combined list names
// every task whose outcome can leave a resolution error on the card.
export const RESEARCH_TASK = "research";

export const CHAT_RESOLUTION_TASKS: readonly string[] = [
  "prototypeSession",
  "grillSession",
  "taskSession",
  "taskHitlSession",
];

export const TICKET_RESOLUTION_TASKS: readonly string[] = [
  RESEARCH_TASK,
  ...CHAT_RESOLUTION_TASKS,
];

// The agent is composing its next reply while the transcript ends on a
// message it must answer (a user message it hasn't replied to yet, or a tool
// result mid-loop). A transcript that ends on the system prompt (or is empty)
// is a session waiting for its first user input — the agent is NOT thinking,
// and showing the indicator there is what makes a claimed-but-idle session
// look stuck.
export function agentIsThinking(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && (last.role === "user" || last.role === "tool");
}

// Reads the error message off a task-outcome entry (the wire shape is open;
// the read is defensive — an absent message reads as a generic failure).
export function readOutcomeError(outcome: unknown): string {
  if (outcome === null || typeof outcome !== "object") return "unknown error";
  const error = (outcome as Record<string, unknown>).error;
  return typeof error === "string" && error !== "" ? error : "unknown error";
}

// The persisted decision record for a closed ticket, read through the
// engine's persisted-output seam (flow-payload reads the decisions directory
// and ships it in the snapshot). Missing when the ticket has no record — the
// renderer degrades to a muted note rather than a broken pane.
export function readDecisionRecord(
  dirs: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
  instanceId: string
): string | undefined {
  return dirs?.decisions?.[`${instanceId}.md`];
}
