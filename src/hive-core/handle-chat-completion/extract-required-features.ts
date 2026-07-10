/** @internal — only imported by handle-chat-completion.ts */

export function extractRequiredFeatures(
  parsed: Record<string, unknown>
): string[] {
  const features: string[] = [];
  if (
    parsed.tools ||
    (Array.isArray(parsed.messages) &&
      parsed.messages.some((m) => m.tool_calls))
  ) {
    features.push("tools");
  }
  if (parsed.response_format != null) {
    features.push("response_format");
  }
  return features;
}
