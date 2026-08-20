/** @private — the card's no-hint fallback readers: task outputs and display
 * values arrive from the wire as unknown; each reader guards its own
 * null/non-object/typeof checks, so a malformed shape degrades to an empty
 * render rather than a crash. */

import type { CardsViewItem } from "../cards-view.ts";

export type TaskOutcomeShape = {
  status?: string;
  error?: string;
  output?: unknown;
};

export function outcomeStatus(outcome: unknown): string {
  const status = (outcome as TaskOutcomeShape | null)?.status;
  return typeof status === "string" ? status : "unknown";
}

export function outcomeError(outcome: unknown): string | null {
  const error = (outcome as TaskOutcomeShape | null)?.error;
  return typeof error === "string" && error !== "" ? error : null;
}

export function outputCards(output: unknown): unknown[] | null {
  if (output === null || typeof output !== "object") return null;
  const cards = (output as Record<string, unknown>).cards;
  return Array.isArray(cards) ? cards : null;
}

// The no-hint fallback for task outputs that read as prose: a string output (or
// an output with a string content) renders as markdown rather than truncated
// text, so agent-written documents keep their structure.
export function markdownSource(output: unknown): string | null {
  if (typeof output === "string" && output !== "") return output;
  if (output === null || typeof output !== "object") return null;
  const content = (output as Record<string, unknown>).content;
  return typeof content === "string" && content !== "" ? content : null;
}

export function summarizeOutput(output: unknown): string | null {
  if (typeof output === "string") return truncate(output, 2000);
  if (output === null || output === undefined) return null;
  if (typeof output !== "object") return String(output);
  const content = (output as Record<string, unknown>).content;
  if (typeof content === "string") return truncate(content, 2000);
  return truncate(JSON.stringify(output, null, 2), 2000);
}

export function toCardsViewItems(cards: unknown[]): CardsViewItem[] {
  return cards.map((card) => {
    if (card === null || typeof card !== "object") return {};
    const record = card as Record<string, unknown>;
    const bullets = Array.isArray(record.bullets)
      ? record.bullets
      : Array.isArray(record.acceptanceCriteria)
        ? record.acceptanceCriteria
        : [];
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
      bullets: bullets.filter((item) => typeof item === "string"),
    };
  });
}

export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  // An array of strings/scalars reads as comma-joined text (no brackets, no
  // quotes); an empty array joins to "". An array containing objects keeps the
  // JSON path — for structured data the shape is the meaning.
  if (Array.isArray(value) && value.every((item) => isScalar(item))) {
    return truncate(value.join(", "), 2000);
  }
  // JSON.stringify returns undefined for undefined/function/symbol; those are
  // handled above (or are non-wire values), but the empty fallback keeps a
  // missing display field from crashing the card render.
  const serialized = JSON.stringify(value, null, 2);
  return truncate(serialized ?? "", 2000);
}

function isScalar(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
