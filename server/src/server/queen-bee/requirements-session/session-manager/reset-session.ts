/** @private — only imported by session-manager.ts */

import type { QueenBeeRuntimeStore } from "../../queen-bee-runtime-store";
import type { RequirementsSession } from "../types";
import { cardSessionKey, ideaSessionKey } from "./keys";
import { restoreProject } from "./restore-project";

export type ResetSessionDeps = {
  sessions: Map<string, RequirementsSession>;
  activeCalls: Map<string, AbortController>;
  runtimeStore?: QueenBeeRuntimeStore;
};

export async function resetSession(
  projectId: string,
  sessionId: string,
  deps: ResetSessionDeps
): Promise<void> {
  const { sessions, activeCalls, runtimeStore } = deps;
  restoreProject(projectId, runtimeStore, sessions);
  const session = [...sessions.values()].find(
    (candidate) =>
      candidate.projectId === projectId && candidate.sessionId === sessionId
  );
  if (!session) {
    throw new Error("Requirements Session not found");
  }
  if (session.status === "submitted") {
    throw new Error("Cannot reset a submitted Requirements Session");
  }
  if (session.cardId || session.ideaId) {
    throw new Error("Can only reset project-level sessions");
  }

  const sessionKey = session.ideaId
    ? ideaSessionKey(projectId, session.ideaId)
    : session.cardId
      ? cardSessionKey(projectId, session.cardId)
      : projectId;

  const controller = activeCalls.get(sessionKey);
  if (controller) {
    controller.abort();
    activeCalls.delete(sessionKey);
  }

  sessions.delete(sessionKey);
  runtimeStore?.deleteRequirementsSession(projectId, sessionId);

  if (session.sourceFeedbackId && runtimeStore) {
    const feedback = runtimeStore.getRequirementsFeedback(
      projectId,
      session.sourceFeedbackId
    );
    if (feedback && feedback.status === "repairing") {
      feedback.status = "pending";
      runtimeStore.saveRequirementsFeedback(feedback);
    }
  }
}
