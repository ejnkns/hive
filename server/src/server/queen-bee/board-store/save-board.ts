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
      createdAt: c.createdAt,
      requirementRefs: c.requirementRefs,
    })),
  };

  writeFileSync(boardPath, JSON.stringify(data, null, 2), "utf-8");
}
