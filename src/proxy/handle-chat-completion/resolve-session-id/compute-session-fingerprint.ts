import { createHash } from "node:crypto";
import type { Message } from "../../../shared/message";

export function computeSessionFingerprint(messages: Message[]): string | null {
  const systemMsg = messages.find((m) => m.role === "system");
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!systemMsg || !firstUserMsg) return null;
  const content = `${systemMsg.content}\n${firstUserMsg.content}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
