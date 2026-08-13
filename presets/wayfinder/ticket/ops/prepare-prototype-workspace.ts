// The ticket workflow's prepare_prototype_workspace operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { prepareWorkspace } from "../../shared/workspace.ts";
import type { TicketState } from "../types.ts";

// A repo-bound prototype workspace is a git worktree on a throwaway branch when
// the flow declares the git identity (integrationBranch/branchPrefix); without
// one — a planning-only flow, or a repo-bound flow with no git config — it is a
// plain sandbox directory. The artifact stays in the prepared workspace and the
// resolution links its path.
function preparePrototypeWorkspaceOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketState>
): Record<string, unknown> {
  const result = prepareWorkspace(ctx);
  if (result.ok !== true) {
    throw new Error(result.message ?? "Failed to prepare prototype workspace");
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

export const prepare_prototype_workspaceOperations =
  defineOperations<TicketState>({
    prepare_prototype_workspace: preparePrototypeWorkspaceOp,
  });
