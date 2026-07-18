/** @private — only imported by board-store.ts */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "../board-store";

export function saveBoard(repoPath: string, board: Board): void {
  const boardPath = join(repoPath, ".hive", "board.json");

  const data = {
    projectId: board.projectId,
    cards: board.cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      acceptanceCriteria: c.acceptanceCriteria,
      relevantFiles: c.relevantFiles,
      dependencies: c.dependencies,
      column: c.column,
      createdAt: c.createdAt,
      workerLog: c.workerLog,
      reviewerLog: c.reviewerLog,
      handover: c.handover,
      coordinatorLog: c.coordinatorLog,
      requirementRefs: c.requirementRefs,
      archivedAt: c.archivedAt,
      branchSummary: c.branchSummary,
      prUrl: c.prUrl,
      prError: c.prError,
    })),
  };

  writeFileSync(boardPath, JSON.stringify(data, null, 2), "utf-8");
}
