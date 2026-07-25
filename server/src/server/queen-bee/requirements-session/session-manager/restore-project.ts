/** @private — only imported by session-manager.ts */

import type { QueenBeeRuntimeStore } from "../../queen-bee-runtime-store";
import type { RequirementsSession } from "../types";
import { cardSessionKey, ideaSessionKey } from "./keys";

export function restoreProject(
  projectId: string,
  runtimeStore: QueenBeeRuntimeStore | undefined,
  sessions: Map<string, RequirementsSession>
): void {
  if (!runtimeStore) return;
  for (const session of runtimeStore.getRequirementsSessions(projectId)) {
    const key = session.ideaId
      ? ideaSessionKey(projectId, session.ideaId)
      : session.cardId
        ? cardSessionKey(projectId, session.cardId)
        : projectId;
    const existing = sessions.get(key);
    if (!existing || existing.updatedAt < session.updatedAt) {
      sessions.set(key, session);
    }
  }
}
