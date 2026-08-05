// Resolves a dotted path like "cardSpec.title" against a nested state object.
// Returns undefined when the path doesn't resolve — never throws.
export function resolveDottedPath(
  state: Record<string, unknown>,
  dottedPath: string | undefined
): unknown {
  if (!dottedPath) return undefined;
  let current: unknown = state;
  for (const segment of dottedPath.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
