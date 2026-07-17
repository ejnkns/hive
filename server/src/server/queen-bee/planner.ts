/** @public */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "shared/message";
import type { BoardStore, Card } from "./board-store";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { executeDeviseTool } from "./devise-engine/devise-tools";
import { PLAN_SYSTEM_PROMPT } from "./planner/plan-system-prompt";

export type Planner = {
  plan(projectId: string, repoPath: string, guidance?: string): Promise<Card[]>;
};

export function createPlanner(boardStore: BoardStore): Planner {
  const modelCaller = createDeviseModelCaller();

  return {
    async plan(
      projectId: string,
      repoPath: string,
      guidance?: string
    ): Promise<Card[]> {
      const requirementsPath = join(repoPath, ".hive", "requirements.md");
      const requirements = readFileSync(requirementsPath, "utf-8");

      let userContent = `Explore the codebase to understand the project structure, then generate cards from this requirements document:\n\n${requirements}`;

      if (guidance) {
        userContent += `\n\nPlanner guidance: ${guidance}`;
      }

      const messages = [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ];

      const result = await callWithToolLoop(modelCaller, messages, repoPath);

      const cards = parseCards(result);

      boardStore.saveCards(projectId, repoPath, cards);

      return cards;
    },
  };
}

async function callWithToolLoop(
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  messages: Message[],
  workspacePath: string,
  maxToolRounds = 10
): Promise<string> {
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await modelCaller.call(messages, workspacePath, true);

    if (response.toolCalls.length === 0) {
      return response.content;
    }

    for (const toolCall of response.toolCalls) {
      const result = executeDeviseTool(toolCall, workspacePath);

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: [
          {
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ],
      });

      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      });
    }
  }

  return "";
}

function parseCards(content: string): Card[] {
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    const tail = content.slice(-1000);
    throw new Error(
      `Planner did not produce valid JSON output. Response (last 1000 chars):\n${tail}`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Planner produced invalid JSON: ${message}\n\nOutput:\n${match[1].slice(0, 1000)}`
    );
  }

  if (!Array.isArray(raw)) {
    throw new Error(`Planner output is not an array. Got: ${typeof raw}`);
  }

  const items = raw as {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    relevantFiles?: string[];
    dependencies?: string[];
  }[];

  const cards = items.map((item, index) => ({
    id: `card-${String(index)}`,
    title: item.title ?? `Untitled card ${String(index)}`,
    description: item.description ?? "",
    acceptanceCriteria: item.acceptanceCriteria ?? [],
    relevantFiles: item.relevantFiles ?? [],
    dependencies: item.dependencies ?? [],
    column: "idea" as const,
    createdAt: new Date().toISOString(),
  }));

  for (const card of cards) {
    if (!card.relevantFiles || card.relevantFiles.length === 0) {
      throw new Error(
        `Card "${card.title}" has no relevant files. Every card must specify at least one file to work on.`
      );
    }
  }

  return cards;
}
