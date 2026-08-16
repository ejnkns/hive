// wayfinder gate: the charting has charted the map (so the

import type { GateContract } from "workflow-engine/workflow-types";

export const frontierCharted: GateContract = (ctx) => {
  return (ctx.workflowInstancesInState?.(undefined, "charted").length ?? 0) > 0;
};
