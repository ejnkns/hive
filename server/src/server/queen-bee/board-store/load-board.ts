/** @private — only imported by board-store.ts */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Idea, ReviewerLog, WorkAttempt } from "shared/board-types";
import type { Board, Card } from "../board-store";
import type { QueenBeeRuntimeStore } from "../queen-bee-runtime-store";

type LegacyReviewerLog = {
  verdict: "pass" | "fail";
  feedback: string;
  reviewedAt: string;
};

type PersistedReviewerLog = ReviewerLog | LegacyReviewerLog;

export function loadBoard(
  projectId: string,
  repoPath: string,
  runtimeStore: QueenBeeRuntimeStore
): Board {
  const hiveDir = join(repoPath, ".hive");
  const boardPath = join(hiveDir, "board.json");
  const raw = readBoard(repoPath, boardPath);
  if (!raw)
    return {
      projectId,
      ideas: runtimeStore.getIdeas(projectId) ?? [],
      cards: [],
    };

  try {
    // Repository JSON is untyped at runtime; each field is validated while
    // reconstructing the Board below, so this shape only names possible input.
    const parsed = JSON.parse(raw) as {
      ideas?: Idea[];
      cards?: {
        id: string;
        title: string;
        description: string;
        acceptanceCriteria: string[];
        relevantFiles: string[];
        dependencies: string[];
        column: string;
        createdAt: string;
        workerLog?: {
          startedAt: string;
          finishedAt: string;
          iterations: number;
          toolCalls: { name: string; args: string }[];
          error?: string;
          content: string;
        };
        reviewerLog?: PersistedReviewerLog;
        handover?: Card["handover"];
        coordinatorLog?: Card["coordinatorLog"];
        requirementRefs?: string[];
        originIdeaIds?: string[];
        workAttempts?: WorkAttempt[];
        archivedAt?: string;
      }[];
    };

    const cards: Card[] = [];
    const persistedIdeas = Array.isArray(parsed.ideas)
      ? parsed.ideas.filter(isIdea)
      : [];
    const ideas = runtimeStore.getIdeas(projectId) ?? persistedIdeas;

    if (parsed.cards && Array.isArray(parsed.cards)) {
      for (const c of parsed.cards) {
        if (c.id && typeof c.id === "string" && typeof c.title === "string") {
          const runtime = runtimeStore.getCardState(projectId, c.id);
          cards.push({
            id: c.id,
            title: c.title,
            description: typeof c.description === "string" ? c.description : "",
            acceptanceCriteria: Array.isArray(c.acceptanceCriteria)
              ? c.acceptanceCriteria
              : [],
            relevantFiles: Array.isArray(c.relevantFiles)
              ? c.relevantFiles
              : [],
            dependencies: Array.isArray(c.dependencies) ? c.dependencies : [],
            column:
              runtime?.column ?? (isColumn(c.column) ? c.column : "ready"),
            createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
            workerLog: runtime?.workerLog ?? c.workerLog,
            reviewerLog:
              runtime?.reviewerLog ?? migrateReviewerLog(c.reviewerLog),
            handover: runtime?.handover ?? c.handover,
            coordinatorLog: runtime?.coordinatorLog ?? c.coordinatorLog,
            requirementRefs: Array.isArray(c.requirementRefs)
              ? c.requirementRefs
              : undefined,
            originIdeaIds: Array.isArray(c.originIdeaIds)
              ? c.originIdeaIds
              : undefined,
            workAttempts:
              runtime?.workAttempts ??
              (Array.isArray(c.workAttempts) ? c.workAttempts : undefined),
            archivedAt: runtime?.archivedAt ?? c.archivedAt,
          });
        }
      }
    }

    return { projectId, ideas, cards };
  } catch {
    return { projectId, ideas: [], cards: [] };
  }
}

function readBoard(repoPath: string, boardPath: string): string | null {
  if (existsSync(boardPath)) return readFileSync(boardPath, "utf-8");
  try {
    return execFileSync("git", ["show", "hive-main:.hive/board.json"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
  } catch {
    return null;
  }
}

function isIdea(value: unknown): value is Idea {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.brief === "string" &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColumn(value: unknown): value is Card["column"] {
  return [
    "ready",
    "in_progress",
    "reviewing",
    "done",
    "unfulfillable",
  ].includes(String(value));
}

function migrateReviewerLog(
  reviewerLog: PersistedReviewerLog | undefined
): ReviewerLog | undefined {
  if (!reviewerLog) return undefined;
  if ("status" in reviewerLog) return reviewerLog;
  const approved = reviewerLog.verdict === "pass";
  return {
    status: "complete",
    verdict: approved ? "approved" : "changes_requested",
    findings: approved
      ? []
      : [
          {
            severity: "blocking",
            requirement: "Legacy reviewer feedback",
            evidence: reviewerLog.feedback,
            recommendation: reviewerLog.feedback,
          },
        ],
    verificationAssessment: {
      status: approved ? "sufficient" : "insufficient",
      notes: reviewerLog.feedback,
    },
    reviewedAt: reviewerLog.reviewedAt,
  };
}
