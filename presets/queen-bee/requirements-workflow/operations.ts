// Requirements workflow internals; import via requirements-workflow.ts.

import type { OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { RequirementsItemState } from "../requirements-workflow.ts";

// The requirements workflow's operations, keyed by the names its tasks
// reference. flow.ts binds the state type and merges this into the registry.
export const requirementsOperations = {
  finalize_requirements: finalizeRequirementsOp,
  clear_requirements_state: clearRequirementsStateOp,
};

// The requirements draft is the requirements session's running output, recorded
// in the instance state by the update_requirements_draft tool. Finalizing
// returns the text; the task persists it as requirements.md. As a recovery for
// sessions where the instance state lost the draft, it extracts the document
// from the session's update_requirements_draft tool call arguments — never the
// agent's conversational reply text.
function finalizeRequirementsOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<RequirementsItemState>
): string {
  const raw = ctx.workflowInstanceState().requirementsDraft;
  const draft = typeof raw === "string" ? raw : "";
  if (draft !== "") return draft;

  const draftTask = ctx.taskOutputs().draft as
    | { status?: string; output?: { messages?: unknown } }
    | undefined;
  const fromToolCall =
    draftTask?.status === "success"
      ? extractRequirementsFromToolCalls(draftTask.output?.messages)
      : undefined;
  if (fromToolCall !== undefined) return fromToolCall;

  throw new Error("No requirements draft to finalize");
}

// The session agent records the requirements by calling update_requirements_draft;
// the document lives in that call's arguments, never in the agent's chat reply.
// Recover the last such call's content from the session message history.
function extractRequirementsFromToolCalls(
  messages: unknown
): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  let found: string | undefined;
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const entry = message as { role?: unknown; tool_calls?: unknown };
    if (entry.role !== "assistant") continue;
    if (!Array.isArray(entry.tool_calls)) continue;
    for (const call of entry.tool_calls) {
      if (call === null || typeof call !== "object") continue;
      const toolCall = call as {
        function?: { name?: unknown; arguments?: unknown };
      };
      if (toolCall.function?.name !== "update_requirements_draft") continue;
      const rawArguments = toolCall.function.arguments;
      if (typeof rawArguments !== "string") continue;
      try {
        const parsed = JSON.parse(rawArguments) as { content?: unknown };
        if (typeof parsed.content === "string" && parsed.content !== "") {
          found = parsed.content;
        }
      } catch {
        // malformed arguments; keep scanning
      }
    }
  }
  return found;
}

// Clears the requirements draft and task outputs from the instance so a reset
// returns the workflow to a truly clean slate. Without this, an old draft
// would survive a reset and auto-approve on the next session.
function clearRequirementsStateOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<RequirementsItemState>
): { ok: boolean } {
  ctx.patchWorkflowInstanceState({ requirementsDraft: undefined });
  return { ok: true };
}
