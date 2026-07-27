/** @private — only imported by requirements-session.ts */

import type { QueenBeeRuntimeStore } from "../queen-bee-runtime-store";
import type { AgentModelCaller } from "./create-model-caller";
import { createAgentModelCaller } from "./create-model-caller";
import { cardSessionKey, ideaSessionKey } from "./session-manager/keys";
import { resetSession as resetSessionInner } from "./session-manager/reset-session";
import { respondSession } from "./session-manager/respond-session";
import { restoreProject } from "./session-manager/restore-project";
import {
  type SessionDeps,
  startSession,
} from "./session-manager/start-session";
import type {
  RequirementsDraftUpdate,
  RequirementsSession,
  RequirementsSessionManager,
} from "./types";

export type CreateSessionManagerParams = {
  maxToolRounds: number;
  modelCaller?: AgentModelCaller;
  runtimeStore?: QueenBeeRuntimeStore;
  onDraftUpdate?: (update: RequirementsDraftUpdate) => void;
};

export function createRequirementsSessionManager(
  params: CreateSessionManagerParams
): RequirementsSessionManager {
  const { runtimeStore } = params;
  const caller = params.modelCaller ?? createAgentModelCaller();
  const sessions = new Map<string, RequirementsSession>();
  const activeCalls = new Map<string, AbortController>();

  const deps: SessionDeps = {
    caller,
    sessions,
    activeCalls,
    runtimeStore,
    onDraftUpdate: params.onDraftUpdate ?? (() => {}),
    maxToolRounds: params.maxToolRounds,
  };

  return {
    async start(projectId, prompt, workspacePath) {
      return startSession(
        {
          sessionKey: projectId,
          projectId,
          kind: "initial_requirements",
          prompt,
          workspacePath,
        },
        deps
      );
    },

    async startRevision(projectId, prompt, workspacePath, replacesProposalId) {
      return startSession(
        {
          sessionKey: projectId,
          projectId,
          kind: "requirements_revision",
          prompt,
          workspacePath,
          allowedProposalId: replacesProposalId,
        },
        deps
      );
    },

    async startIdea(projectId, idea, prompt, workspacePath) {
      return startSession(
        {
          sessionKey: ideaSessionKey(projectId, idea.id),
          projectId,
          kind: "idea_elaboration",
          prompt,
          workspacePath,
          sourceIdea: idea,
        },
        deps
      );
    },

    async startRepair(projectId, feedback, workspacePath, sourceIdea) {
      return startSession(
        {
          sessionKey: projectId,
          projectId,
          kind: "requirements_repair",
          prompt: "Resolve the structured Requirements Feedback with the user.",
          workspacePath,
          sourceIdea,
          feedback,
          sourceIdeaId: feedback.sourceIdeaId,
          sourceFeedbackId: feedback.id,
        },
        deps
      );
    },

    async startCard(projectId, cardId, prompt, workspacePath) {
      return startSession(
        {
          sessionKey: cardSessionKey(projectId, cardId),
          projectId,
          kind: "requirements_repair",
          prompt,
          workspacePath,
          cardId,
        },
        deps
      );
    },

    async respond(projectId, answer, workspacePath) {
      return respondSession(projectId, answer, workspacePath, deps);
    },

    async respondIdea(projectId, ideaId, answer, workspacePath) {
      return respondSession(
        ideaSessionKey(projectId, ideaId),
        answer,
        workspacePath,
        deps
      );
    },

    async respondCard(projectId, cardId, answer, workspacePath) {
      return respondSession(
        cardSessionKey(projectId, cardId),
        answer,
        workspacePath,
        deps
      );
    },

    getSession(projectId) {
      restoreProject(projectId, runtimeStore, sessions);
      return [...sessions.values()]
        .filter(
          (session) =>
            session.projectId === projectId &&
            !session.cardId &&
            !session.ideaId
        )
        .at(-1);
    },

    submitForPlanning(projectId, sessionId, planningOutcomeId) {
      restoreProject(projectId, runtimeStore, sessions);
      const session = [...sessions.values()].find(
        (candidate) =>
          candidate.projectId === projectId && candidate.sessionId === sessionId
      );
      if (session?.status !== "complete") {
        throw new Error("Requirements Session is not ready for planning");
      }
      const submittedAt = new Date().toISOString();
      session.status = "submitted";
      session.planningOutcomeId = planningOutcomeId;
      session.submittedAt = submittedAt;
      session.updatedAt = submittedAt;
      runtimeStore?.saveRequirementsSession(session);
    },

    getIdeaSession(projectId, ideaId) {
      restoreProject(projectId, runtimeStore, sessions);
      return sessions.get(ideaSessionKey(projectId, ideaId));
    },

    getCardSession(projectId, cardId) {
      restoreProject(projectId, runtimeStore, sessions);
      return sessions.get(cardSessionKey(projectId, cardId));
    },

    async resetSession(projectId, sessionId) {
      return resetSessionInner(projectId, sessionId, {
        sessions,
        activeCalls,
        runtimeStore,
      });
    },
  };
}
