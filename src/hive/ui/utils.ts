export function sc(c: number): string {
  return c >= 80
    ? "var(--success)"
    : c >= 50
      ? "var(--warning)"
      : "var(--error)";
}

export function ft(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fv(v: number | null, suf?: string): string {
  if (v == null || isNaN(v)) return "—";
  if (suf === "ms") return v >= 1000 ? (v / 1000).toFixed(1) + "s" : v + "ms";
  return String(v);
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
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && part.text) return part.text;
        if (part && part.type) return "[" + part.type + "]";
        return "";
      })
      .join("\n");
  }
  return String(content);
}

export function safeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-");
}
