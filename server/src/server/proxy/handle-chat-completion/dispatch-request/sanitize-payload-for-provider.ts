import type { Message } from "shared/message";

export function sanitizePayloadForProvider(
  _providerName: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const msgs = cloned.messages;
  if (!Array.isArray(msgs)) return cloned;

  const cleaned = msgs.map((msg: unknown) => {
    const m = { ...(msg as Message) } as Message & {
      reasoning_content?: string;
    };
    if (m.role === "assistant" && "reasoning_content" in m) {
      if (m.reasoning_content && typeof m.content === "string") {
        m.content = `[Thought: ${m.reasoning_content}]\n\n${m.content}`;
      }
      delete m.reasoning_content;
    }
    return m;
  });

  const merged: typeof cleaned = [];
  for (let i = 0; i < cleaned.length; i++) {
    const current = cleaned[i];
    if (current.role === "assistant" && Array.isArray(current.tool_calls)) {
      while (i + 1 < cleaned.length) {
        const next = cleaned[i + 1];
        if (next.role === "assistant" && Array.isArray(next.tool_calls)) {
          current.tool_calls = [...current.tool_calls, ...next.tool_calls];
          i++;
        } else {
          break;
        }
      }
    }
    merged.push(current);
  }

  cloned.messages = merged;
  return cloned;
}
