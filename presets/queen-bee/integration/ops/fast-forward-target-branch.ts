// The integration workflow's fast_forward_target_branch operation, referenced
// by the queen-bee blueprint.

import {
  defineOperations,
  fastForwardTargetBranch,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { IntegrationState } from "../types.ts";

function fastForwardTargetBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<IntegrationState>
): Record<string, unknown> {
  const config = ctx.flowConfig();
  const basePath = typeof config.basePath === "string" ? config.basePath : "";
  // The target branch is a flow-level decision inferred at onboarding and
  // recorded in flowState (flow config is static).
  const targetBranch =
    typeof ctx.flowState().targetBranch === "string"
      ? (ctx.flowState().targetBranch as string)
      : "main";
  return fastForwardTargetBranch(task, { basePath, targetBranch }, ctx);
}

export const fast_forward_target_branchOperations =
  defineOperations<IntegrationState>({
    fast_forward_target_branch: fastForwardTargetBranchOp,
  });
