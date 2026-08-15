// The requirements workflow's clear_requirements_state operation, referenced
// by the queen-bee blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { RequirementsState } from "../types.ts";

// Clears the requirements draft from the instance so a reset returns the
// workflow to a truly clean slate. Without this, an old draft would survive a
// reset and auto-approve on the next session.
function clearRequirementsStateOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<RequirementsState>
): { ok: boolean } {
  ctx.patchWorkflowInstanceState({ requirementsDraft: undefined });
  return { ok: true };
}

export const clear_requirements_stateOperations =
  defineOperations<RequirementsState>({
    clear_requirements_state: clearRequirementsStateOp,
  });
