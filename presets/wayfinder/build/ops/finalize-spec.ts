// The build workflow's finalize_spec operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { BuildState } from "../types.ts";

// The spec is the specing session's running output, recorded in the instance
// state by the submit_spec tool. Finalizing returns the text; the task persists
// it as spec.md. As a recovery for sessions where the instance state lost the
// spec, it extracts the document from the session's submit_spec tool call
// arguments — never the agent's conversational reply text.
function finalizeSpecOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<BuildState>
): string {
  const raw = ctx.workflowInstanceState().spec;
  const spec = typeof raw === "string" ? raw : "";
  if (spec !== "") return spec;

  const specSession = ctx.taskOutputs().specSession as
    | { status?: string; output?: { messages?: unknown } }
    | undefined;
  const fromToolCall =
    specSession?.status === "success"
      ? extractSpecFromToolCalls(specSession.output?.messages)
      : undefined;
  if (fromToolCall !== undefined) return fromToolCall;

  throw new Error("No spec to finalize");
}

// The specing agent records the spec by calling submit_spec; the document lives
// in that call's arguments, never in the agent's chat reply. Recover the last
// such call's content from the session message history.
function extractSpecFromToolCalls(messages: unknown): string | undefined {
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
      if (toolCall.function?.name !== "submit_spec") continue;
      const rawArguments = toolCall.function.arguments;
      if (typeof rawArguments !== "string") continue;
      try {
        const parsed = JSON.parse(rawArguments) as { spec?: unknown };
        if (typeof parsed.spec === "string" && parsed.spec !== "") {
          found = parsed.spec;
        }
      } catch {
        // malformed arguments; keep scanning
      }
    }
  }
  return found;
}

export const finalize_specOperations = defineOperations<BuildState>({
  finalize_spec: finalizeSpecOp,
});
