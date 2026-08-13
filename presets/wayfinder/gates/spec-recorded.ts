// wayfinder gate: the specing session recorded a non-empty spec.

import type { GateContract } from "workflow-engine/workflow-types";

// The spec must be recorded before planning: the planner is grounded in it and
// finalizing persists it. Prevents reaching planned with no spec.
export const specRecorded: GateContract = (ctx) => {
  const spec = ctx.workflowInstanceState.spec;
  return typeof spec === "string" && spec.trim() !== "";
};
