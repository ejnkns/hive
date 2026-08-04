// Resolves a dotted path like "cardSpec.title" against a value. The empty
// string resolves to the root. Returns undefined when any segment is missing
// or non-object.

export function resolvePath(value: unknown, path: string): unknown {
  if (path === "") return value;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    // The object check above narrows the value; the record cast reads a
    // dynamic key that plain object typing cannot express.
    const record = current as Record<string, unknown>;
    current = record[part];
    if (current === undefined) return undefined;
  }
  return current;
}
