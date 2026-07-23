/**
 * Normalize a provider-reported model ID into its canonical form for
 * deduplication across providers with different naming conventions.
 *
 * Transformations:
 * 1. Lowercase
 * 2. Strip leading "~" (soft alias prefix, OpenRouter)
 * 3. Strip org namespace prefix (any segment before the first "/")
 * 4. Strip ":free" suffix
 * 5. Strip "-free" suffix
 */
export function normalizeModelId(raw: string): string {
  let id = raw.toLowerCase();

  if (id.startsWith("~")) id = id.slice(1);

  const slashIdx = id.indexOf("/");
  if (slashIdx > 0 && slashIdx < id.length - 1) {
    id = id.slice(slashIdx + 1);
  }

  if (id.endsWith(":free")) id = id.slice(0, -5);

  if (id.endsWith("-free")) id = id.slice(0, -5);

  return id;
}
