// The imports workflow's prepare_input operation, referenced by the honeycomb
// flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { ImportsState } from "../types.ts";

// Builds the parse task's input digest: the raw text as JSON. Written into
// instanceState; the parse task seeds from it. The parse agent reads the
// existing taxonomy itself via the read_taxonomy tool.
function prepareInputOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<ImportsState>
) {
  const state = ctx.workflowInstanceState();
  const rawText = state.rawText ?? "";
  ctx.patchWorkflowInstanceState({
    digest: JSON.stringify({ rawText }),
  });
  return { ok: true, chars: rawText.length };
}

export const prepare_inputOperations = defineOperations<ImportsState>({
  prepare_input: prepareInputOp,
});
