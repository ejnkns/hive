/** @private — only imported by devise-engine.ts */

import type { PassThrough, Readable } from "node:stream";

import type { Message } from "shared/message";

import { handleChatCompletion } from "../../proxy";

export type DeviseModelCaller = {
  call(messages: Message[]): Promise<{ content: string; finishReason: string }>;
};

export function createDeviseModelCaller(): DeviseModelCaller {
  return {
    async call(messages) {
      const result = await handleChatCompletion({ messages, stream: true }, {});

      if (!result.success || !result.stream) {
        throw new Error(result.error ?? "Model call failed");
      }

      const parsed = await consumeStream(result.stream);
      return {
        content: parsed.content,
        finishReason: parsed.finishReason ?? "stop",
      };
    },
  };
}

type ParsedStream = {
  content: string;
  finishReason: string | null;
};

async function consumeStream(
  stream: Readable | PassThrough
): Promise<ParsedStream> {
  let content = "";
  let finishReason: string | null = null;
  let buffer = "";

  return new Promise<ParsedStream>((resolve, reject) => {
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

          if (choices?.[0]) {
            const choice = choices[0];
            const delta = choice.delta as Record<string, unknown> | undefined;
            if (delta?.content && typeof delta.content === "string") {
              content += delta.content;
            }
            if (
              choice.finish_reason &&
              typeof choice.finish_reason === "string"
            ) {
              finishReason = choice.finish_reason;
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    });

    stream.on("end", () => {
      resolve({ content, finishReason });
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}
