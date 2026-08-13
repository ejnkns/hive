// wayfinder gate: every dependsOn blocker is closed.

import type { GateContract } from "workflow-engine/workflow-types";

// The frontier check: a claim action is visible only when every dependsOn
// blocker is closed. The engine's dependsOnState backstop re-checks at
// dispatch.
export const blockersClosed: GateContract = (ctx) => {
  const dependsOn = ctx.workflowInstanceState.dependsOn;
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return true;
  const closedIds = new Set(
    (ctx.workflowInstancesInState?.("closed") ?? []).map(
      (instance) => instance.id
    )
  );
  return dependsOn.every((id) => closedIds.has(id));
};
