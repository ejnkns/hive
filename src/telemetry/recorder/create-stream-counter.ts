import { Transform } from "node:stream";
import { logger } from "../../shared/logger";
import type { FinishReason } from "../request-metric";

type StreamDelta = {
  content?: string;
  reasoning_content?: string;
};

type StreamChoice = {
  delta?: StreamDelta;
  finish_reason?: string | null;
};

type StreamChunk = {
  choices?: StreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type StreamStats = {
  outputChars: number;
  thinkingChars: number;
  thinkingStart: number | null;
  thinkingEnd: number | null;
  thinkingTime: number | null;
  finishReason: FinishReason;
  responseText: string;
  inputTokens: number | null;
  outputTokensFromUsage: number | null;
  isAbruptDisconnect: boolean;
};

export function createStreamCounter(startTime: number) {
  let outputChars = 0;
  let thinkingChars = 0;
  let thinkingStart: number | null = null;
  let thinkingEnd: number | null = null;
  let hasReceivedContent = false;
  let isAbruptDisconnect = true;
  let finishReason: FinishReason = null;
  let responseText = "";
  let inputTokens: number | null = null;
  let outputTokensFromUsage: number | null = null;
  let buffer = "";

  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = chunk.toString("utf-8");
      buffer += text;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") {
          isAbruptDisconnect = false;
          logger.debug("parse-stream: received DONE, stream completed normally");
          continue;
        }

        try {
          // JSON.parse returns unknown; shape validated by downstream access
          const parsed = JSON.parse(jsonStr) as StreamChunk;
          const delta = parsed.choices?.[0]?.delta;
          const finish = parsed.choices?.[0]?.finish_reason;

          if (finish) {
            // API finish_reason values align with FinishReason union
            finishReason = finish as FinishReason;
            isAbruptDisconnect = false;
            logger.debug(`parse-stream: finish reason: ${finish}`);
          }

          if (parsed.usage) {
            if (typeof parsed.usage.prompt_tokens === "number") {
              inputTokens = parsed.usage.prompt_tokens;
              logger.debug(`parse-stream: prompt_tokens: ${String(inputTokens)}`);
            }
            if (typeof parsed.usage.completion_tokens === "number") {
              outputTokensFromUsage = parsed.usage.completion_tokens;
              logger.debug(`parse-stream: completion_tokens: ${String(outputTokensFromUsage)}`);
            }
          }

          if (delta?.reasoning_content) {
            if (thinkingStart === null) {
              thinkingStart = Date.now() - startTime;
              logger.debug(`parse-stream: thinking_start: ${String(thinkingStart)}ms`);
            }
            thinkingChars += delta.reasoning_content.length;
            responseText += delta.reasoning_content;
          }

          if (delta?.content) {
            if (thinkingStart !== null && !hasReceivedContent) {
              thinkingEnd = Date.now() - startTime;
              hasReceivedContent = true;
              logger.debug(
                `parse-stream: thinking_end: ${String(thinkingEnd)}ms, thinking_time: ${String(thinkingEnd - thinkingStart)}ms`
              );
            }
            outputChars += delta.content.length;
            responseText += delta.content;
            logger.debug(
              `parse-stream: content_chars +${String(delta.content.length)} (total: ${String(outputChars)})`
            );
          }
        } catch (err) {
          // err is caught from JSON.parse — known to be Error
          logger.debug(`parse-stream: skipped unparseable chunk: ${(err as Error).message}`);
        }
      }

      callback(null, chunk);
    },
  });

  const getStats = (): StreamStats => {
    let thinkingTime: number | null = null;
    if (thinkingStart !== null) {
      const end = thinkingEnd ?? (isAbruptDisconnect ? thinkingStart : Date.now() - startTime);
      thinkingTime = end - thinkingStart;
    }

    logger.debug(
      `parse-stream: stats — outputChars: ${String(outputChars)}, thinkingChars: ${String(thinkingChars)}, ` +
        `thinkingTime: ${String(thinkingTime ?? "N/A")}, finishReason: ${finishReason ?? "N/A"}, ` +
        `responseText length: ${String(responseText.length)}, isAbruptDisconnect: ${String(isAbruptDisconnect)}`
    );

    return {
      outputChars,
      thinkingChars,
      thinkingStart,
      thinkingEnd,
      thinkingTime,
      finishReason,
      responseText,
      inputTokens,
      outputTokensFromUsage,
      isAbruptDisconnect,
    };
  };

  return { transform, getStats };
}
