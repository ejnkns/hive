import type { Message } from "../hive-core";

type ToolCall = {
  type?: string;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ToolLoopResult = {
  toolName: string;
  arguments: string;
};

const THRESHOLD = 3;

function buildToolKey(toolCall: ToolCall): string | null {
  if (!toolCall.function?.name) return null;
  const args = toolCall.function.arguments ?? "{}";
  return `${toolCall.function.name}|${args}`;
}

export function detectToolLoop(messages: Message[]): ToolLoopResult | null {
  const counts = new Map<string, number>();

  for (let i = messages.length - 1; i > 0; i -= 2) {
    const current = messages[i];
    const previous = messages[i - 1];

    if (current.role !== "tool" || previous.role !== "assistant") break;

    const toolCalls = previous.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length !== 1) break;

    const key = buildToolKey(toolCalls[0] as ToolCall);
    if (!key) break;

    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);

    if (count >= THRESHOLD) {
      const func = toolCalls[0].function!;
      return {
        toolName: func.name!,
        arguments: func.arguments ?? "{}",
      };
    }
  }

  return null;
}
