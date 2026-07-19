/** @private — shared model transport for Queen Bee agents */

import type { PassThrough, Readable } from "node:stream";

import type { Message } from "shared/message";

import { handleChatCompletion } from "../../proxy";
import {
  AGENT_TOOLS,
  type ToolCall,
  type ToolDefinition,
} from "./devise-tools";

export type AgentModelCaller = {
  call(
    messages: Message[],
    workspacePath: string,
    includeTools: boolean,
    signal?: AbortSignal
  ): Promise<AgentModelResponse>;
};

export type AgentModelResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  reasoningContent?: string;
  reasoning?: string;
};

export function createAgentModelCaller(
  tools?: ToolDefinition[]
): AgentModelCaller {
  const activeTools = tools ?? AGENT_TOOLS;

  return {
    async call(messages, workspacePath, includeTools, signal) {
      const payload: Record<string, unknown> = {
        messages,
        stream: true,
      };

      if (includeTools) {
        payload.tools = activeTools;
      }

      const result = await handleChatCompletion(payload, {});

      if (!result.success || !result.stream) {
        throw new Error(result.error ?? "Model call failed");
      }

      return consumeStream(result.stream, workspacePath, signal);
    },
  };
}

async function consumeStream(
  stream: Readable | PassThrough,
  _workspacePath: string,
  signal?: AbortSignal
): Promise<AgentModelResponse> {
  let content = "";
  let reasoningContent = "";
  let reasoning = "";
  let finishReason: string | null = null;
  let buffer = "";

  type ToolAccumulator = {
    id: string;
    type: string;
    name: string;
    arguments: string;
  };
  const toolCalls = new Map<number, ToolAccumulator>();

  return new Promise<AgentModelResponse>((resolve, reject) => {
    function abort(): void {
      stream.destroy(new Error("Model call cancelled"));
      reject(signal?.reason ?? new Error("Model call cancelled"));
    }
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);

        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const choices = parsed.choices as
            | Array<Record<string, unknown>>
            | undefined;

          if (!choices?.[0]) continue;

          const choice = choices[0];
          const delta = choice.delta as Record<string, unknown> | undefined;

          if (delta?.content && typeof delta.content === "string") {
            content += delta.content;
          }

          if (
            delta?.reasoning_content &&
            typeof delta.reasoning_content === "string"
          ) {
            reasoningContent += delta.reasoning_content;
          }

          if (delta?.reasoning && typeof delta.reasoning === "string") {
            reasoning += delta.reasoning;
          }

          if (
            choice.finish_reason &&
            typeof choice.finish_reason === "string"
          ) {
            finishReason = choice.finish_reason;
          }

          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const toolCall = tc as Record<string, unknown>;
              const index =
                typeof toolCall.index === "number" ? toolCall.index : undefined;
              if (index === undefined) continue;

              const existing = toolCalls.get(index);
              if (existing) {
                if (toolCall.id && typeof toolCall.id === "string")
                  existing.id = toolCall.id;
                if (toolCall.type && typeof toolCall.type === "string")
                  existing.type = toolCall.type;
                const fn = toolCall.function as
                  | Record<string, unknown>
                  | undefined;
                if (fn?.name && typeof fn.name === "string")
                  existing.name = fn.name;
                if (fn?.arguments && typeof fn.arguments === "string")
                  existing.arguments += fn.arguments;
              } else {
                const fn = (toolCall.function ?? {}) as Record<string, unknown>;
                toolCalls.set(index, {
                  id: (typeof toolCall.id === "string"
                    ? toolCall.id
                    : "") as string,
                  type: (typeof toolCall.type === "string"
                    ? toolCall.type
                    : "function") as string,
                  name: (typeof fn.name === "string" ? fn.name : "") as string,
                  arguments: (typeof fn.arguments === "string"
                    ? fn.arguments
                    : "") as string,
                });
              }
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    });

    stream.on("end", () => {
      signal?.removeEventListener("abort", abort);
      const parsedToolCalls = Array.from(toolCalls.values()).map(
        (tc) =>
          ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }) as ToolCall
      );

      resolve({
        content,
        toolCalls: parsedToolCalls,
        finishReason: finishReason ?? "stop",
        reasoningContent: reasoningContent || undefined,
        reasoning: reasoning || undefined,
      });
    });

    stream.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
  });
}
