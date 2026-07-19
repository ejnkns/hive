/** @public */

import type { CoordinatorSuggestion } from "shared/board-types";
import type { Card } from "./board-store";
import { COORDINATOR_SYSTEM_PROMPT } from "./coordinator/coordinator-system-prompt";
import {
  type AgentModelCaller,
  createAgentModelCaller,
} from "./devise-engine/create-devise-model-caller";

export type CoordinatorAnalysis = {
  summary: string;
  suggestions: CoordinatorSuggestion[];
};

export type Coordinator = {
  analyze(
    card: Card,
    requirementsContent: string
  ): Promise<CoordinatorAnalysis>;
};

export function createCoordinator(modelCaller?: AgentModelCaller): Coordinator {
  const caller = modelCaller ?? createAgentModelCaller();

  return {
    async analyze(card, requirementsContent) {
      if (!card.handover) {
        throw new Error("Coordinator requires a card handover");
      }

      const response = await caller.call(
        [
          { role: "system", content: COORDINATOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `## Project requirements\n${requirementsContent}`,
              `## Card\n${card.title}\n${card.description}`,
              `## Handover\nProblem: ${card.handover.problem}\nAttempted: ${card.handover.attempted.join("; ") || "None"}\nBlocked by: ${card.handover.blockedBy.join("; ") || "None"}`,
            ].join("\n\n"),
          },
        ],
        "",
        false
      );

      return parseCoordinatorAnalysis(response.content);
    },
  };
}

function parseCoordinatorAnalysis(content: string): CoordinatorAnalysis {
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  const json = match?.[1] ?? content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Coordinator returned invalid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Coordinator returned an invalid analysis");
  }

  const value = parsed as {
    summary?: unknown;
    suggestions?: unknown;
  };
  if (typeof value.summary !== "string" || !Array.isArray(value.suggestions)) {
    throw new Error("Coordinator analysis requires summary and suggestions");
  }

  const suggestions = value.suggestions.map(parseSuggestion);
  return { summary: value.summary, suggestions };
}

function parseSuggestion(value: unknown): CoordinatorSuggestion {
  if (!value || typeof value !== "object") {
    throw new Error("Coordinator suggestion is invalid");
  }
  const suggestion = value as Record<string, unknown>;
  const action = suggestion.action;
  if (
    typeof suggestion.id !== "string" ||
    typeof suggestion.rationale !== "string" ||
    (action !== "retry_with_patch" &&
      action !== "redevise" &&
      action !== "archive")
  ) {
    throw new Error("Coordinator suggestion has invalid fields");
  }

  return {
    id: suggestion.id,
    action,
    rationale: suggestion.rationale,
    cardPatch: isCardPatch(suggestion.cardPatch)
      ? (suggestion.cardPatch as CoordinatorSuggestion["cardPatch"])
      : undefined,
    requirementsContent:
      typeof suggestion.requirementsContent === "string"
        ? suggestion.requirementsContent
        : undefined,
  };
}

function isCardPatch(value: unknown): boolean {
  return Boolean(value && typeof value === "object");
}
