/**
 * Sanitizes the chat completion payload before sending to a provider.
 *
 * Reasoning fields (reasoning_content, reasoning) are preserved as-is
 * — models that produce them need them in subsequent tool-call turns.
 *
 * Consecutive assistant messages with tool_calls are merged into one
 * to comply with provider API requirements.
 */
export function sanitizePayloadForProvider(
  body: Record<string, unknown>
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const msgs = cloned.messages;
  if (!Array.isArray(msgs)) return cloned;

  const merged: typeof msgs = [];
  for (let i = 0; i < msgs.length; i++) {
    const current = msgs[i];
    if (
      (current as Record<string, unknown>).role === "assistant" &&
      Array.isArray((current as Record<string, unknown>).tool_calls)
    ) {
      while (i + 1 < msgs.length) {
        const next = msgs[i + 1];
        if (
          (next as Record<string, unknown>).role === "assistant" &&
          Array.isArray((next as Record<string, unknown>).tool_calls)
        ) {
          (current as Record<string, unknown>).tool_calls = [
            ...((current as Record<string, unknown>).tool_calls as unknown[]),
            ...((next as Record<string, unknown>).tool_calls as unknown[]),
          ];
          i++;
        } else {
          break;
        }
      }
    }
    merged.push(current);
  }

  cloned.messages = merged;
  return cloned;
}
