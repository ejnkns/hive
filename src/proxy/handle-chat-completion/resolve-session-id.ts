import { generateId } from "../../shared/generate-id";
import type { Message } from "../../shared/message";
import { computeSessionFingerprint } from "./resolve-session-id/compute-session-fingerprint";
import { extractSessionHeader } from "./resolve-session-id/extract-session-header";

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
