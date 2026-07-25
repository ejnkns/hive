/** @private — type definitions for the requirements session module. Re-exported from requirements-session.ts */

import type {
  Idea,
  RequirementsFeedback,
  RequirementsSessionKind,
} from "shared/board-types";
import type { PersistedRequirementsSession } from "../queen-bee-runtime-store";

export type RequirementsSession = PersistedRequirementsSession;

export type RequirementsDraftUpdate = {
  projectId: string;
  sessionId: string;
  cardId?: string;
  ideaId?: string;
  content: string;
};

export type RequirementsSessionManager = {
  start(
    projectId: string,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  startRevision(
    projectId: string,
    prompt: string,
    workspacePath: string,
    replacesProposalId?: string
  ): Promise<RequirementsStartResult>;
  startIdea(
    projectId: string,
    idea: Idea,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  startRepair(
    projectId: string,
    feedback: RequirementsFeedback,
    workspacePath: string,
    sourceIdea?: Idea
  ): Promise<RequirementsStartResult>;
  respondIdea(
    projectId: string,
    ideaId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getIdeaSession(
    projectId: string,
    ideaId: string
  ): RequirementsSession | undefined;
  respond(
    projectId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getSession(projectId: string): RequirementsSession | undefined;
  submitForPlanning(
    projectId: string,
    sessionId: string,
    planningOutcomeId: string
  ): void;
  startCard(
    projectId: string,
    cardId: string,
    prompt: string,
    workspacePath: string
  ): Promise<RequirementsStartResult>;
  respondCard(
    projectId: string,
    cardId: string,
    answer: string,
    workspacePath: string
  ): Promise<RequirementsRespondResult>;
  getCardSession(
    projectId: string,
    cardId: string
  ): RequirementsSession | undefined;
  resetSession(projectId: string, sessionId: string): Promise<void>;
};

export type RequirementsStartResult = {
  sessionId: string;
  question: string;
  draftRequirements?: string;
};

export type RequirementsRespondResult =
  | { type: "question"; question: string; draftRequirements?: string }
  | { type: "complete"; spec: string; draftRequirements: string };

export type StartRequirementsSessionInput = {
  sessionKey: string;
  projectId: string;
  kind: RequirementsSessionKind;
  prompt: string;
  workspacePath: string;
  cardId?: string;
  sourceIdea?: Idea;
  feedback?: RequirementsFeedback;
  sourceIdeaId?: string;
  sourceFeedbackId?: string;
  allowedProposalId?: string;
};
