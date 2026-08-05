import type { Readable } from "node:stream";

// Parses an OpenAI-compatible SSE chat-completions stream, invoking onDelta for
// each choices[0].delta. Shared by the engine model-caller (content + tool
// calls) and the one-shot flow generator (content only). Handles chunk
// buffering, [DONE], malformed chunks, and optional abort.
export function consumeSseStream(
  stream: Readable,
  onDelta: (delta: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  let buffer = "";

  return new Promise((resolve, reject) => {
    function onAbort(): void {
      stream.destroy(new Error("Cancelled"));
      reject(signal?.reason ?? new Error("Cancelled"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

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
          const delta = choices?.[0]?.delta as
            | Record<string, unknown>
            | undefined;
          if (delta) onDelta(delta);
        } catch {
          // skip malformed chunks
        }
      }
    });

    stream.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });

    stream.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}
