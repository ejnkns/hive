/** @private — only imported by board-store.ts */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "../board-store";

export function saveCard(repoPath: string, card: Card): void {
  const cardPath = join(repoPath, ".hive", "cards", `${card.id}.json`);

  const data = {
    id: card.id,
    title: card.title,
    description: card.description,
    acceptanceCriteria: card.acceptanceCriteria,
    relevantFiles: card.relevantFiles,
    dependencies: card.dependencies,
    createdAt: card.createdAt,
    requirementRefs: card.requirementRefs,
  };

  writeFileSync(cardPath, JSON.stringify(data, null, 2), "utf-8");
}
