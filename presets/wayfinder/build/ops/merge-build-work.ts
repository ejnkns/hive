// The build-item workflow's merge_build_work operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  mergeBranch,
  type OperationContext,
  readFlowSettings,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { BuildTicketState } from "../types.ts";

// Accepted build work merges into the flow's integration branch only when the
// flow declares the git identity (basePath + integrationBranch + branchPrefix);
// otherwise it stays in the workspace for the user to integrate manually.
function mergeBuildWorkOp(
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext<BuildTicketState>
): Record<string, unknown> {
  const settings = readFlowSettings(ctx.flowConfig());
  if (
    settings.basePath === undefined ||
    settings.integrationBranch === undefined ||
    settings.branchPrefix === undefined
  ) {
    return { ok: true, skipped: true };
  }
  return mergeBranch(task, params, ctx);
}

export const merge_build_workOperations = defineOperations<BuildTicketState>({
  merge_build_work: mergeBuildWorkOp,
});
