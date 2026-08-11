// Integration workflow internals; import via integration-workflow.ts.

import {
  fastForwardTargetBranch,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { IntegrationItemState } from "../integration-workflow.ts";

export const integrationOperations = {
  fast_forward_target_branch: fastForwardTargetBranchOp,
};

function fastForwardTargetBranchOp(
  task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<IntegrationItemState>
): Record<string, unknown> {
  const config = ctx.flowConfig();
  const basePath = typeof config.basePath === "string" ? config.basePath : "";
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return fastForwardTargetBranch(task, { basePath, targetBranch }, ctx);
}
