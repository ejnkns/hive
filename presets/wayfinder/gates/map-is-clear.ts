// wayfinder gate: the map is charted and the frontier is clear.

import type { GateContract } from "workflow-engine/workflow-types";

// A ticket is open while it is not terminal. The frontier is the set of ready
// tickets; map-clear means nothing is left to resolve.
const OPEN_TICKET_STATES = [
  "fog",
  "ready",
  "resolving_research",
  "resolving_prototype",
  "resolving_grilling",
  "resolving_task",
  "resolving_task_hitl",
  "recording",
] as const;

// Start build is available only when the charting has charted the map and the
// frontier is empty: no ticket is fog, ready, resolving, or recording.
export const mapIsClear: GateContract = (ctx) => {
  if (ctx.workflowInstancesInState?.("charted").length === 0) return false;
  return OPEN_TICKET_STATES.every(
    (state) => (ctx.workflowInstancesInState?.(state).length ?? 0) === 0
  );
};
