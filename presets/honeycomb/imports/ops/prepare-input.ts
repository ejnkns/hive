// The imports workflow's prepare_input operation, referenced by the honeycomb
// flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { ImportsState } from "../types.ts";

// Builds the parse task's input digest: the raw text plus its declared source,
// so the parse agent can tag every split idea with the correct source without
// guessing. Written into instanceState; the parse task seeds from it.
function prepareInputOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<ImportsState>
) {
  const state = ctx.workflowInstanceState();
  const source = state.source ?? "manual";
  const rawText = state.rawText ?? "";
  ctx.patchWorkflowInstanceState({
    digest: JSON.stringify({ source, rawText }),
  });
  return { ok: true, source, chars: rawText.length };
}

export const prepare_inputOperations = defineOperations<ImportsState>({
  prepare_input: prepareInputOp,
});
