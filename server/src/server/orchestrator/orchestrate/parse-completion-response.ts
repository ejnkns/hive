/** @internal — only imported by orchestrate.ts */

import type { ToolCall } from "../tools/tool";

type ParsedCompletion = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
};

export function parseCompletionResponse(body: string): ParsedCompletion {
  // JSON.parse returns unknown; shape validated by property access below
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: "", toolCalls: [], finishReason: null };
  }

  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown> | undefined;
  if (!message) {
    return { content: "", toolCalls: [], finishReason: null };
  }

  const content = typeof message.content === "string" ? message.content : "";
  const finishReason =
    typeof choice.finish_reason === "string" ? choice.finish_reason : null;

  const toolCalls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const call = tc as Record<string, unknown>;
      const func = call.function as Record<string, unknown> | undefined;
      if (!func) continue;
      const id = typeof call.id === "string" ? call.id : "";
      const name = typeof func.name === "string" ? func.name : "";
      const args = typeof func.arguments === "string" ? func.arguments : "{}";
      toolCalls.push({ id, name, arguments: args });
    }
  }

  return { content, toolCalls, finishReason };
}
