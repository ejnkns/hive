/** @internal — only imported by detect-loop.ts */

import type { Message } from "../../../shared/message";

type ToolCall = {
  type?: string;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type EditLoopResult = {
  filePath: string;
  oldString: string;
};

const THRESHOLD = 3;

function parseEditArgs(
  toolCall: ToolCall
): { filePath: string; oldString: string } | null {
  if (toolCall.function?.name !== "edit") return null;
  if (!toolCall.function?.arguments) return null;
  try {
    // JSON.parse returns unknown; shape checked by property access
    const args = JSON.parse(toolCall.function.arguments) as Record<
      string,
      unknown
    >;
    if (
      typeof args.filePath === "string" &&
      typeof args.oldString === "string"
    ) {
      return { filePath: args.filePath, oldString: args.oldString };
    }
  } catch {
    return null;
  }
  return null;
}

function isEditFailure(toolMsg: Message): boolean {
  return (
    typeof toolMsg.content === "string" &&
    toolMsg.content.includes("Could not find oldString in the file")
  );
}

export function detectEditLoop(messages: Message[]): EditLoopResult | null {
  const counts = new Map<string, number>();

  for (let i = messages.length - 1; i > 0; i -= 2) {
    const current = messages[i];
    const previous = messages[i - 1];

    if (current.role !== "tool" || previous.role !== "assistant") break;

    const toolCalls = previous.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length !== 1) break;

    const edit = parseEditArgs(toolCalls[0] as ToolCall);
    if (!edit) break;

    if (!isEditFailure(current)) break;

    const key = `${edit.filePath}::${edit.oldString}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);

    if (count >= THRESHOLD) {
      return edit;
    }
  }

  return null;
}
