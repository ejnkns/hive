// The requirements workflow's approve gate: a requirements document must be
// recorded before planning (the planner is grounded in it, and finalizing
// persists it). Prevents reaching planning/finalizing with no requirements.

import type { GateContract } from "workflow-engine/workflow-types";

export const draftRecorded: GateContract = (ctx) => {
  const draft = ctx.workflowInstanceState.requirementsDraft;
  return typeof draft === "string" && draft.trim() !== "";
};
