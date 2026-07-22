import type { ConversationMessage } from "./types";

export function sc(c: number): string {
  return c >= 70
    ? "var(--success)"
    : c >= 50
      ? "var(--warning)"
      : "var(--error)";
}

export function healthColor(score: number, requestCount: number): string {
  if (requestCount === 0) return "var(--muted)";
  return sc(score);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatNumber(v: number | null, suf?: string): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (suf === "ms")
    return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${String(v)}ms`;
  return v.toFixed(2) + (suf ? ` ${suf}` : "");
}

export function esc(input: unknown): string {
  const s = typeof input === "string" ? input : String(input);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part != null) {
          // narrowed by typeof check above; content is ContentPart[] known shape
          const obj = part as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.type === "string") return `[${obj.type}]`;
        }
        return "";
      })
      .join("\n");
  }
  return String(content);
}

export function safeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-");
}

export function resolveToolName(
  messages: ConversationMessage[],
  toolCallId: string
): string | null {
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id === toolCallId) return tc.function.name;
      }
    }
  }
  return null;
}

export function groupToolCalls(
  toolCalls: { function: { name: string } }[]
): { name: string; count: number }[] {
  const groups: { name: string; count: number }[] = [];
  for (const tc of toolCalls) {
    const last = groups.at(-1);
    if (last && last.name === tc.function.name) {
      last.count++;
    } else {
      groups.push({ name: tc.function.name, count: 1 });
    }
  }
  return groups;
}

export function formatToolCallLabel(tc: {
  name: string;
  count: number;
}): string {
  return tc.count > 1 ? `${tc.name} \u00d7 ${tc.count}` : tc.name;
}
