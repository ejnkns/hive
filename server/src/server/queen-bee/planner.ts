/** @public */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardStore, Card } from "./board-store";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { PLAN_SYSTEM_PROMPT } from "./planner/plan-system-prompt";

export type Planner = {
  plan(projectId: string, repoPath: string): Promise<Card[]>;
};

export function createPlanner(boardStore: BoardStore): Planner {
  const modelCaller = createDeviseModelCaller();

  return {
    async plan(projectId: string, repoPath: string): Promise<Card[]> {
      const requirementsPath = join(repoPath, ".hive", "requirements.md");
      const requirements = readFileSync(requirementsPath, "utf-8");

      const messages = [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: `Requirements:\n\n${requirements}` },
      ];

      const result = await modelCaller.call(messages, repoPath, false);

      const cards = parseCards(result.content);

      boardStore.saveCards(projectId, repoPath, cards);

      return cards;
    },
  };
}

function parseCards(content: string): Card[] {
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error("Planner did not produce valid JSON output");
  }

  const raw = JSON.parse(match[1]) as {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    relevantFiles?: string[];
    dependencies?: string[];
  }[];

  if (!Array.isArray(raw)) {
    throw new Error("Planner output is not an array");
  }

  return raw.map((item, index) => ({
    id: `card-${String(index)}`,
    title: item.title ?? `Untitled card ${String(index)}`,
    description: item.description ?? "",
    acceptanceCriteria: item.acceptanceCriteria ?? [],
    relevantFiles: item.relevantFiles ?? [],
    dependencies: item.dependencies ?? [],
    column: "idea" as const,
    createdAt: new Date().toISOString(),
  }));
}
