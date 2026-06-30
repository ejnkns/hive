export function extractRequiredFeatures(parsed: Record<string, unknown>): string[] {
  const features: string[] = [];
  if (
    parsed.tools ||
    (Array.isArray(parsed.messages) &&
      // cast justified: we checked Array.isArray on the same line
      (parsed.messages as Array<Record<string, unknown>>).some((m) => m.tool_calls))
  ) {
    features.push("tools");
  }
  return features;
}
