/** @internal — only imported by orchestrate.ts */

import type { Readable } from "node:stream";
import { logger } from "shared/logger";
import type { ParsedModelResponse } from "../types";

type StreamDelta = {
  content?: string;
  reasoning_content?: string;
  tool_calls?: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

type StreamChoice = {
  delta?: StreamDelta;
  finish_reason?: string | null;
};

type StreamChunk = {
  choices?: StreamChoice[];
};

type ToolCallAccumulator = {
  id: string;
  type: string;
  name: string;
  arguments: string;
};

export async function consumeSSEStream(
  stream: Readable,
  onChunk: (chunk: { content?: string }) => void
): Promise<ParsedModelResponse> {
  let content = "";
  let finishReason: string | null = null;
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let buffer = "";
  let chunkCount = 0;

  for await (const chunk of stream) {
    chunkCount++;
    const text = Buffer.from(chunk as Uint8Array).toString("utf-8");
    logger.debug(
      `consumeSSEStream — chunk ${String(chunkCount)}: ${String(text.length)} chars, preview: ${text.slice(0, 500).replace(/\n/g, "\\n")}`
    );
    buffer += text;

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      const jsonStr = trimmed.slice(6);
      if (jsonStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(jsonStr) as StreamChunk;
        const delta = parsed.choices?.[0]?.delta;
        const finish = parsed.choices?.[0]?.finish_reason;

        if (finish) {
          finishReason = finish;
        }

        if (delta?.content) {
          content += delta.content;
          onChunk({ content: delta.content });
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index === undefined) continue;
            const existing = toolCalls.get(tc.index);
            if (existing) {
              if (tc.id) existing.id = tc.id;
              if (tc.type) existing.type = tc.type;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments)
                existing.arguments += tc.function.arguments;
            } else {
              toolCalls.set(tc.index, {
                id: tc.id ?? "",
                type: tc.type ?? "function",
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            }
          }
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  logger.debug(
    `consumeSSEStream — stream ended: ${String(chunkCount)} chunks received, contentLength=${String(content.length)}, toolCalls=${String(toolCalls.size)}, finishReason=${finishReason ?? "null"}`
  );

  return {
    content,
    toolCalls: Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    })),
    finishReason,
  };
}
