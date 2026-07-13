/** @internal — only imported by handle-chat-completion.ts */

import type { Message } from "../../shared/message";
import { detectEditLoop } from "./detect-and-inject-loop-messages/detect-edit-loop";
import { detectToolLoop } from "./detect-and-inject-loop-messages/detect-tool-loop";

export function detectAndInjectLoopMessages(
  parsed: Record<string, unknown>,
  messages: Message[]
): { parsed: Record<string, unknown>; toolLoopDetected: boolean } {
  const toolLoop = detectToolLoop(messages);
  if (toolLoop) {
    const modified = {
      ...parsed,
      messages: [
        ...messages,
        {
          role: "system",
          content: `You have called "${toolLoop.toolName}" with identical arguments repeatedly. You appear to be stuck in a loop. Try a different approach or tool.`,
        },
      ],
    };
    return { parsed: modified, toolLoopDetected: true };
  }

  const editLoop = detectEditLoop(messages);
  if (editLoop) {
    const modified = {
      ...parsed,
      messages: [
        ...messages,
        {
          role: "system",
          content: `The edit tool failed repeatedly on "${editLoop.filePath}". Use the read tool to refresh the file content before attempting more edits.`,
        },
      ],
    };
    return { parsed: modified, toolLoopDetected: false };
  }

  return { parsed, toolLoopDetected: false };
}
