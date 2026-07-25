/** @private — only imported by session-manager.ts */

import type { RequirementsRespondResult } from "../types";
import { callWithToolLoop } from "./call-with-tool-loop";
import { detectCompletion } from "./detect-completion";
import { extractSpec } from "./extract-spec";
import { restoreProject } from "./restore-project";
import type { SessionDeps } from "./start-session";

export async function respondSession(
  sessionKey: string,
  answer: string,
  workspacePath: string,
  deps: SessionDeps
): Promise<RequirementsRespondResult> {
  const { sessions, activeCalls, runtimeStore, onDraftUpdate } = deps;
  const projectId = sessionKey.split(/:(?:card|idea):/)[0] ?? sessionKey;
  restoreProject(projectId, runtimeStore, sessions);
  const session = sessions.get(sessionKey);
  if (session?.status !== "active") {
    throw new Error("No active Requirements Session for this project");
  }

  session.messages.push({ role: "user", content: answer });

  const controller = new AbortController();
  activeCalls.set(sessionKey, controller);
  let result: Awaited<ReturnType<typeof callWithToolLoop>>;
  try {
    result = await callWithToolLoop(
      deps.caller,
      session.messages,
      workspacePath,
      (content) => {
        session.draftRequirements = content;
        session.updatedAt = new Date().toISOString();
        runtimeStore?.saveRequirementsSession(session);
        onDraftUpdate({
          projectId: session.projectId,
          sessionId: session.sessionId,
          cardId: session.cardId,
          ideaId: session.ideaId,
          content,
        });
      },
      session.projectRevision === null ? undefined : session.projectRevision,
      controller.signal
    );
  } finally {
    if (activeCalls.get(sessionKey) === controller) {
      activeCalls.delete(sessionKey);
    }
  }

  if (result.draftRequirements) {
    session.draftRequirements = result.draftRequirements;
  }
  const isComplete = detectCompletion(result.content);

  session.messages.push({
    role: "assistant",
    content: isComplete ? extractSpec(result.content) : result.content,
  });

  if (isComplete) {
    if (!session.draftRequirements) {
      throw new Error(
        "Requirements Agent completed without submitting a requirements draft"
      );
    }
    session.status = "complete";
    session.updatedAt = new Date().toISOString();
    runtimeStore?.saveRequirementsSession(session);
    return {
      type: "complete",
      spec: extractSpec(result.content),
      draftRequirements: session.draftRequirements,
    };
  }

  session.updatedAt = new Date().toISOString();
  runtimeStore?.saveRequirementsSession(session);
  return {
    type: "question",
    question: result.content,
    draftRequirements: session.draftRequirements,
  };
}
