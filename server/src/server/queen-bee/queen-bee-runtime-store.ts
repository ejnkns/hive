/** @public */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  Card,
  CardActivityEvent,
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { HIVE_DIR } from "shared/hive-dir";
import type { Message } from "shared/message";
import type { RequirementsSessionKind } from "./devise-engine/devise-system-prompt";
import type { ReviewPackage } from "./reviewer";

export type { ActivityActor, CardActivityEvent } from "shared/board-types";

export type NewCardActivityEvent = Omit<CardActivityEvent, "id" | "occurredAt">;

export type CardRuntimeState = Pick<
  Card,
  | "column"
  | "workerLog"
  | "reviewerLog"
  | "handover"
  | "coordinatorLog"
  | "workAttempts"
  | "archivedAt"
>;

export type PersistedRequirementsSession = {
  sessionId: string;
  projectId: string;
  cardId?: string;
  ideaId?: string;
  sourceIdeaId?: string;
  sourceFeedbackId?: string;
  kind: RequirementsSessionKind;
  messages: Message[];
  status: "active" | "complete" | "submitted";
  planningOutcomeId?: string;
  submittedAt?: string;
  baseRequirementsRevision: string;
  projectRevision: string | null;
  draftRequirements?: string;
  startedAt: string;
  updatedAt: string;
};

export type QueenBeeRuntimeStore = {
  saveReviewPackage(projectId: string, reviewPackage: ReviewPackage): void;
  getReviewPackage(projectId: string, packageId: string): ReviewPackage | null;
  appendActivity(
    projectId: string,
    cardId: string,
    event: NewCardActivityEvent
  ): CardActivityEvent;
  getActivity(projectId: string, cardId: string): CardActivityEvent[];
  saveCardState(
    projectId: string,
    cardId: string,
    state: CardRuntimeState
  ): void;
  getCardState(projectId: string, cardId: string): CardRuntimeState | null;
  saveRequirementsSession(session: PersistedRequirementsSession): void;
  getRequirementsSessions(projectId: string): PersistedRequirementsSession[];
  savePlanningProposal(proposal: PlanningProposal): void;
  getPlanningProposal(
    projectId: string,
    proposalId: string
  ): PlanningProposal | null;
  getPlanningProposals(projectId: string): PlanningProposal[];
  saveRequirementsFeedback(feedback: RequirementsFeedback): void;
  getRequirementsFeedback(
    projectId: string,
    feedbackId: string
  ): RequirementsFeedback | null;
  getRequirementsFeedbacks(projectId: string): RequirementsFeedback[];
};

export function createQueenBeeRuntimeStore(
  rootDirectory = HIVE_DIR
): QueenBeeRuntimeStore {
  return {
    saveReviewPackage(projectId, reviewPackage) {
      const path = reviewPackagePath(
        rootDirectory,
        projectId,
        reviewPackage.id
      );
      if (existsSync(path)) {
        const existing = readFileSync(path, "utf-8");
        if (existing !== serialize(reviewPackage)) {
          throw new Error(
            `Review Package '${reviewPackage.id}' is immutable and already exists`
          );
        }
        return;
      }
      writeJson(path, reviewPackage);
    },

    getReviewPackage(projectId, packageId) {
      const reviewPackage = readJson<ReviewPackage>(
        reviewPackagePath(rootDirectory, projectId, packageId)
      );
      if (!reviewPackage) return null;
      return {
        ...reviewPackage,
        revisions: {
          ...reviewPackage.revisions,
          reviewCommit:
            reviewPackage.revisions.reviewCommit ??
            reviewPackage.revisions.headCommit,
        },
      };
    },

    appendActivity(projectId, cardId, event) {
      const path = activityPath(rootDirectory, projectId, cardId);
      const activity = readJson<CardActivityEvent[]>(path) ?? [];
      const recorded: CardActivityEvent = {
        ...event,
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
      };
      writeJson(path, [...activity, recorded]);
      return recorded;
    },

    getActivity(projectId, cardId) {
      return (
        readJson<CardActivityEvent[]>(
          activityPath(rootDirectory, projectId, cardId)
        ) ?? []
      );
    },

    saveCardState(projectId, cardId, state) {
      writeJson(cardStatePath(rootDirectory, projectId, cardId), state);
    },

    getCardState(projectId, cardId) {
      return readJson<CardRuntimeState>(
        cardStatePath(rootDirectory, projectId, cardId)
      );
    },

    saveRequirementsSession(session) {
      writeJson(
        requirementsSessionPath(
          rootDirectory,
          session.projectId,
          session.sessionId
        ),
        session
      );
    },

    getRequirementsSessions(projectId) {
      const directory = requirementsSessionDirectory(rootDirectory, projectId);
      try {
        return readdirSync(directory)
          .filter((name) => name.endsWith(".json"))
          .map((name) =>
            readJson<PersistedRequirementsSession>(join(directory, name))
          )
          .filter((session): session is PersistedRequirementsSession =>
            Boolean(session)
          )
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
      } catch {
        return [];
      }
    },

    savePlanningProposal(proposal) {
      writeJson(
        planningProposalPath(rootDirectory, proposal.projectId, proposal.id),
        proposal
      );
    },

    getPlanningProposal(projectId, proposalId) {
      return readJson<PlanningProposal>(
        planningProposalPath(rootDirectory, projectId, proposalId)
      );
    },

    getPlanningProposals(projectId) {
      return readJsonDirectory<PlanningProposal>(
        planningProposalDirectory(rootDirectory, projectId),
        (proposal) => proposal.createdAt
      );
    },

    saveRequirementsFeedback(feedback) {
      writeJson(
        requirementsFeedbackPath(
          rootDirectory,
          feedback.projectId,
          feedback.id
        ),
        feedback
      );
    },

    getRequirementsFeedback(projectId, feedbackId) {
      return readJson<RequirementsFeedback>(
        requirementsFeedbackPath(rootDirectory, projectId, feedbackId)
      );
    },

    getRequirementsFeedbacks(projectId) {
      return readJsonDirectory<RequirementsFeedback>(
        requirementsFeedbackDirectory(rootDirectory, projectId),
        (feedback) => feedback.createdAt
      );
    },
  };
}

function projectDirectory(rootDirectory: string, projectId: string): string {
  return join(
    rootDirectory,
    "queen-bee",
    "projects",
    encodeURIComponent(projectId)
  );
}

function reviewPackagePath(
  rootDirectory: string,
  projectId: string,
  packageId: string
): string {
  return join(
    projectDirectory(rootDirectory, projectId),
    "review-packages",
    `${encodeURIComponent(packageId)}.json`
  );
}

function activityPath(
  rootDirectory: string,
  projectId: string,
  cardId: string
): string {
  return join(
    projectDirectory(rootDirectory, projectId),
    "activity",
    `${encodeURIComponent(cardId)}.json`
  );
}

function cardStatePath(
  rootDirectory: string,
  projectId: string,
  cardId: string
): string {
  return join(
    projectDirectory(rootDirectory, projectId),
    "card-state",
    `${encodeURIComponent(cardId)}.json`
  );
}

function requirementsSessionDirectory(
  rootDirectory: string,
  projectId: string
): string {
  return join(
    rootDirectory,
    "requirements-sessions",
    encodeURIComponent(projectId)
  );
}

function requirementsSessionPath(
  rootDirectory: string,
  projectId: string,
  sessionId: string
): string {
  return join(
    requirementsSessionDirectory(rootDirectory, projectId),
    `${encodeURIComponent(sessionId)}.json`
  );
}

function planningProposalPath(
  rootDirectory: string,
  projectId: string,
  proposalId: string
): string {
  return join(
    planningProposalDirectory(rootDirectory, projectId),
    `${encodeURIComponent(proposalId)}.json`
  );
}

function planningProposalDirectory(
  rootDirectory: string,
  projectId: string
): string {
  return join(projectDirectory(rootDirectory, projectId), "planning-proposals");
}

function requirementsFeedbackPath(
  rootDirectory: string,
  projectId: string,
  feedbackId: string
): string {
  return join(
    requirementsFeedbackDirectory(rootDirectory, projectId),
    `${encodeURIComponent(feedbackId)}.json`
  );
}

function requirementsFeedbackDirectory(
  rootDirectory: string,
  projectId: string
): string {
  return join(
    projectDirectory(rootDirectory, projectId),
    "requirements-feedback"
  );
}

function readJsonDirectory<T>(
  directory: string,
  timestamp: (value: T) => string
): T[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<T>(join(directory, name)))
      .filter((value): value is T => value !== null)
      .sort((left, right) => timestamp(left).localeCompare(timestamp(right)));
  } catch {
    return [];
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, serialize(value), "utf-8");
  renameSync(temporaryPath, path);
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
