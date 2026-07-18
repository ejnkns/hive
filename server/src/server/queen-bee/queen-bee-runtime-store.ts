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
import type { Card, CardActivityEvent } from "shared/board-types";
import { HIVE_DIR } from "shared/hive-dir";
import type { Message } from "shared/message";
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

export type PersistedDeviseSession = {
  sessionId: string;
  projectId: string;
  cardId?: string;
  messages: Message[];
  status: "active" | "complete";
  baseRequirementsRevision: string;
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
  saveDeviseSession(session: PersistedDeviseSession): void;
  getDeviseSessions(projectId: string): PersistedDeviseSession[];
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
      return readJson<ReviewPackage>(
        reviewPackagePath(rootDirectory, projectId, packageId)
      );
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

    saveDeviseSession(session) {
      writeJson(
        deviseSessionPath(rootDirectory, session.projectId, session.sessionId),
        session
      );
    },

    getDeviseSessions(projectId) {
      const directory = deviseSessionDirectory(rootDirectory, projectId);
      try {
        return readdirSync(directory)
          .filter((name) => name.endsWith(".json"))
          .map((name) =>
            readJson<PersistedDeviseSession>(join(directory, name))
          )
          .filter((session): session is PersistedDeviseSession =>
            Boolean(session)
          )
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
      } catch {
        return [];
      }
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

function deviseSessionDirectory(
  rootDirectory: string,
  projectId: string
): string {
  return join(rootDirectory, "devise-sessions", encodeURIComponent(projectId));
}

function deviseSessionPath(
  rootDirectory: string,
  projectId: string,
  sessionId: string
): string {
  return join(
    deviseSessionDirectory(rootDirectory, projectId),
    `${encodeURIComponent(sessionId)}.json`
  );
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
