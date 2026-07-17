/** @private — only imported by board-store.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Card } from "../board-store";

export function loadBoard(projectId: string, repoPath: string): Board {
  const hiveDir = join(repoPath, ".hive");
  const boardPath = join(hiveDir, "board.json");
  const _cardsDir = join(hiveDir, "cards");

  if (!existsSync(boardPath)) {
    return { projectId, cards: [] };
  }

  try {
    const raw = readFileSync(boardPath, "utf-8");
    const parsed = JSON.parse(raw) as {
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
        reviewerLog?: {
          verdict: "pass" | "fail";
          feedback: string;
          reviewedAt: string;
        };
      }[];
    };

    const cards: Card[] = [];

    if (parsed.cards && Array.isArray(parsed.cards)) {
      for (const c of parsed.cards) {
        if (c.id && typeof c.id === "string" && typeof c.title === "string") {
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
            column: (typeof c.column === "string"
              ? c.column
              : "idea") as Card["column"],
            createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
            workerLog: c.workerLog,
            reviewerLog: c.reviewerLog,
          });
        }
      }
    }

    return { projectId, cards };
  } catch {
    return { projectId, cards: [] };
  }
}
