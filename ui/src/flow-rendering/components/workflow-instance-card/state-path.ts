/** @private — only imported by workflow-instance-card.ts */

import type { WorkflowHistoryEntry } from "workflow-engine/workflow-types";

// The distinct states an instance has passed through, in first-visit order,
// ending with the current state. Derived from state_transition history so a
// card can show its lifecycle as a dot strip.
export function statePath(
  history: readonly WorkflowHistoryEntry[],
  currentState: string
): string[] {
  const seen: string[] = [];
  for (const entry of history) {
    if (entry.type !== "state_transition") continue;
    for (const state of [entry.fromState, entry.toState]) {
      if (!seen.includes(state)) seen.push(state);
    }
  }
  if (!seen.includes(currentState)) seen.push(currentState);
  return seen;
}
