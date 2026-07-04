export function sc(c: number): string {
  return c >= 70
    ? "var(--success)"
    : c >= 50
      ? "var(--warning)"
      : "var(--error)";
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

export function bar(pct: number): string {
  const f = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "\u2588".repeat(f) + "\u2591".repeat(10 - f);
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
