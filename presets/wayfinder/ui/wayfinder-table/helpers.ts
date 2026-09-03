/** @private — only imported by wayfinder-table.ts: pure presentation
 * helpers for the table workbench — the desk rotation, the live
 * model-call status label, the depot crate titles, and the fog
 * clear-order (session-local ordering of the fog tray). */
import type { ModelCallStatus } from "workflow-engine/workflow-types";

export function cardRotation(index: number): string {
  const magnitude = 0.4 + ((index * 3) % 4) * 0.3;
  return `${index % 2 === 0 ? -magnitude : magnitude}deg`;
}

// The live model-call stage, human-readable for the card's status line.
export function modelStatusLabel(status: ModelCallStatus | undefined): string {
  switch (status?.stage) {
    case "dispatched":
      return `researching via ${status.provider} · ${status.model}`;
    case "thinking":
      return "thinking…";
    case "streaming":
      return "writing the report…";
    case "complete":
      return "finalizing…";
    case "error":
      return `research error: ${status.message}`;
    default:
      return "routing the research call…";
  }
}

// The first non-empty line of a markdown file, for the depot crates' titles.
export function firstLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first ?? text.slice(0, 60);
}

// Orders the fog tickets by the stored clear-order id list; entries absent
// from the list keep their natural relative order. The list is session-local
// — it survives re-renders and persists in sessionStorage keyed by flow id.
export function inClearOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[]
): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    rank.set(id, index);
  });
  return [...items].sort((a, b) => {
    const ar = rank.get(a.id);
    const br = rank.get(b.id);
    if (ar === undefined && br === undefined) return 0;
    if (ar === undefined) return 1;
    if (br === undefined) return -1;
    return ar - br;
  });
}

// The new clear order after a fog drop: the dragged id re-enters before the
// first remaining card whose vertical middle sits below the pointer, or at
// the pile's end when the drop lands past every card.
export function fogDropOrder(
  draggedId: string,
  remaining: ReadonlyArray<{ id: string; middle: number }>,
  dropY: number
): string[] {
  const rest = remaining.map((card) => card.id);
  const before = remaining.find((card) => dropY < card.middle);
  const at = before === undefined ? rest.length : rest.indexOf(before.id);
  const next = [...rest];
  next.splice(at, 0, draggedId);
  return next;
}
