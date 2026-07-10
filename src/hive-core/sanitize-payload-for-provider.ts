import type { Message } from "./message";

export function sanitizePayloadForProvider(
  providerName: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  // Deep clone via JSON round-trip yields same shape as input
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const msgs = cloned.messages;
  if (!Array.isArray(msgs)) return cloned;
  if (providerName !== "opencode-zen") {
    cloned.messages = msgs.map((msg: unknown) => {
      // msgs elements are already validated as Array<Record> upstream
      const m = msg as Message;
      if (m.role === "assistant" && "reasoning_content" in m) {
        if (m.reasoning_content && typeof m.content === "string") {
          m.content = `[Thought: ${m.reasoning_content}]\n\n${m.content}`;
        }
        delete m.reasoning_content;
      }
      return m;
    });
  }
  return cloned;
}
