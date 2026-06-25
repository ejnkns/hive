import { Transform } from "node:stream";

type StreamStats = {
  outputChars: number;
  thinkingChars: number;
  thinkingStart: number | null;
  thinkingEnd: number | null;
  thinkingTime: number | null;
  finishReason: string | null;
  responseText: string;
  inputTokens: number | null;
  outputTokensFromUsage: number | null;
};

export function createStreamCounter(startTime: number) {
  let outputChars = 0;
  let thinkingChars = 0;
  let thinkingStart: number | null = null;
  let thinkingEnd: number | null = null;
  let hasReceivedContent = false;
  let finishReason: string | null = null;
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
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          const finish = parsed.choices?.[0]?.finish_reason;

          if (finish) {
            finishReason = finish;
          }

          if (parsed.usage) {
            if (typeof parsed.usage.prompt_tokens === "number") {
              inputTokens = parsed.usage.prompt_tokens;
            }
            if (typeof parsed.usage.completion_tokens === "number") {
              outputTokensFromUsage = parsed.usage.completion_tokens;
            }
          }

          if (delta?.reasoning_content) {
            if (thinkingStart === null) {
              thinkingStart = Date.now() - startTime;
            }
            thinkingChars += delta.reasoning_content.length;
            responseText += delta.reasoning_content;
          }

          if (delta?.content) {
            if (thinkingStart !== null && !hasReceivedContent) {
              thinkingEnd = Date.now() - startTime;
              hasReceivedContent = true;
            }
            outputChars += delta.content.length;
            responseText += delta.content;
          }
        } catch {
          // skip unparseable chunks
        }
      }

      callback(null, chunk);
    },
  });

  const getStats = (): StreamStats => {
    let thinkingTime: number | null = null;
    if (thinkingStart !== null) {
      const end = thinkingEnd ?? Date.now() - startTime;
      thinkingTime = end - thinkingStart;
    }

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
    };
  };

  return { transform, getStats };
}
