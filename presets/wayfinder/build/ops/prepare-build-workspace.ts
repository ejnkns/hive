// The build-item workflow's prepare_build_workspace operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { prepareWorkspace } from "../../shared/workspace.ts";
import type { BuildTicketState } from "../types.ts";

// A repo-bound build workspace is a git worktree on a feature branch when the
// flow declares the git identity (integrationBranch/branchPrefix); without one
// — a planning-only flow, or a repo-bound flow with no git config — it is a
// plain sandbox directory. The worker's edits land there either way; accepted
// work stays in the workspace (see merge_build_work).
function prepareBuildWorkspaceOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<BuildTicketState>
): Record<string, unknown> {
  const result = prepareWorkspace(ctx);
  if (result.ok !== true) {
    throw new Error(result.message ?? "Failed to prepare build workspace");
  }
  ctx.patchWorkflowInstanceState({
    worktreePath: result.path,
    branchName: result.branchName,
  });
  return {
    ok: true,
    path: result.path,
    branchName: result.branchName,
    baseCommit: result.baseCommit,
  };
}

export const prepare_build_workspaceOperations =
  defineOperations<BuildTicketState>({
    prepare_build_workspace: prepareBuildWorkspaceOp,
  });
