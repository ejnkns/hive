import type { Message } from "shared/message";
import { loadProjectContext } from "../../project-context";

export function systemMessage(content: string): Message {
  return { role: "system", content };
}

export function projectContext(
  projectId: string,
  workspacePath: string
): ReturnType<typeof loadProjectContext> | null {
  try {
    return loadProjectContext(projectId, workspacePath);
  } catch {
    return null;
  }
}

export function projectContextMessages(
  context: ReturnType<typeof loadProjectContext> | null
): Message[] {
  if (context) {
    return [
      {
        role: "system",
        content: `Shared Project Context at ${context.revision}:\n${JSON.stringify(
          { files: context.files, manifests: context.manifests },
          null,
          2
        )}`,
      },
    ];
  }
  return [];
}
