// honeycomb gate: the "Start organizing" flow-level action stays visible only
// until an organize instance exists — honeycomb's organize is a singleton
// brain, one taxonomy, one global pass.

import type { GateContract } from "workflow-engine/workflow-types";

export const organizeExists: GateContract = (ctx) => {
  return (ctx.workflowInstancesInState?.("organize").length ?? 0) === 0;
};
