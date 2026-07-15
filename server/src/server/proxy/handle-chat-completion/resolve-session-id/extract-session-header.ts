const SESSION_HEADERS = [
  "x-session-id",
  "x-session-affinity",
  "x-parent-session-id",
] as const;

export function extractSessionHeader(
  headers: Record<string, string | string[] | undefined>
): string | null {
  for (const name of SESSION_HEADERS) {
    const value = headers[name];
    if (typeof value === "string" && value.length > 0) return value;
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "string"
    )
      return value[0];
  }
  return null;
}
