import { computeSessionFingerprint } from "./compute-session-fingerprint";
import { extractSessionHeader } from "./extract-session-header";
import { generateId } from "./generate-id";
import type { Message } from "./message";

export function resolveSessionId(
  headers: Record<string, string | string[] | undefined>,
  messages: Message[]
): string {
  const headerId = extractSessionHeader(headers);
  if (headerId) return headerId;
  const fingerprint = computeSessionFingerprint(messages);
  if (fingerprint) return fingerprint;
  return generateId();
}
