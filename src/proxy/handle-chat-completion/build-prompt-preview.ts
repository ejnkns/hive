import type { Message } from "../../shared/message";

export function buildPromptPreview(lastMsg: Message | undefined): string {
  if (!lastMsg) return "";

  if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    const tc = lastMsg.tool_calls[0] as Record<string, unknown>;
    const func = tc.function as Record<string, unknown> | undefined;
    if (func?.name) {
      let preview = `tool: ${String(func.name)}`;
      try {
        const argsStr =
          typeof func.arguments === "string" ? func.arguments : "";
        if (argsStr) {
          const args = JSON.parse(argsStr) as Record<string, unknown>;
          const firstKey = Object.keys(args)[0];
          if (firstKey) {
            preview += ` ${firstKey}=${JSON.stringify(args[firstKey])}`;
          }
        }
      } catch {}
      return preview.slice(0, 120);
    }
  }

  if (lastMsg.role === "tool") {
    const text = typeof lastMsg.content === "string" ? lastMsg.content : "";
    return `tool result (${text.length} chars)`;
  }

  const text = typeof lastMsg.content === "string" ? lastMsg.content : "";
  return text.slice(0, 120);
}
