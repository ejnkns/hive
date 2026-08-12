/** @private — the authoring tools' shared result helpers: the divergence gate
 * both blueprint tools enforce, and the shared error shape the file tools
 * return. Only flow-authoring/session/tools/* import from here. */

import type { AuthoringItemState } from "../state.ts";

// The divergence gate both blueprint tools enforce: while the human owns the
// source (blueprintDiverged, set by the editor's write-back), the agent must
// not overwrite it — it proposes in chat instead.
export function divergedResult(call: { id: string }): {
  toolCallId: string;
  content: string;
  isError: boolean;
} {
  return {
    toolCallId: call.id,
    content:
      "The definition has manual edits (the user edited the TypeScript directly), so the blueprint is frozen. Do not overwrite it. Propose changes in chat — read the current source with read_definition_source — and let the user apply them, discard their edits, or adopt them.",
    isError: true,
  };
}

export function isDiverged(ctx: {
  workflowInstanceState?: () => AuthoringItemState;
}): boolean {
  return ctx.workflowInstanceState?.()?.blueprintDiverged === true;
}

// The shared error result shape for the authoring tools.
export function toolError(
  call: { id: string },
  message: string
): {
  toolCallId: string;
  content: string;
  isError: boolean;
} {
  return { toolCallId: call.id, content: message, isError: true };
}
