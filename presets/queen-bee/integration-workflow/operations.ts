// Integration workflow internals; import via integration-workflow.ts.

import type { OperationContext, OperationFn } from "workflow-engine/runners";
import { fastForwardTargetBranch } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

export const integrationOperations: Record<string, OperationFn> = {
  fast_forward_target_branch: fastForwardTargetBranchOp,
};

function fastForwardTargetBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext
): Record<string, unknown> {
  const config = ctx.flowConfig();
  const basePath = typeof config.basePath === "string" ? config.basePath : "";
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return fastForwardTargetBranch(task, { basePath, targetBranch }, ctx);
}
