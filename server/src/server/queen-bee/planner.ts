/** @public */

import { randomUUID } from "node:crypto";
import type {
  CardSpecification,
  PlanningChange,
  PlanningProposal,
} from "shared/board-types";
import { generateId } from "shared/generate-id";
import type { Message } from "shared/message";
import type { BoardStore, Card } from "./board-store";
import {
  createDeviseModelCaller,
  type DeviseModelCaller,
} from "./devise-engine/create-devise-model-caller";
import { DEVISE_TOOLS, executeDeviseTool } from "./devise-engine/devise-tools";
import type { IntegrationManager } from "./integration-manager";
import { PLAN_SYSTEM_PROMPT } from "./planner/plan-system-prompt";
import { loadProjectContext } from "./project-context";
import type { QueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import {
  readRequirements,
  requirementsRevision,
  writeRequirements,
} from "./requirements-store";

const PLANNER_TOOLS = DEVISE_TOOLS.filter((tool) =>
  ["list_directory", "read_file", "search_code"].includes(tool.function.name)
);

export type Planner = {
  propose(
    projectId: string,
    repoPath: string,
    proposedRequirements: string,
    guidance?: string
  ): Promise<PlanningProposal>;
  decide(
    projectId: string,
    proposalId: string,
    changeId: string,
    decision: "accepted" | "rejected"
  ): PlanningProposal;
  acceptAll(projectId: string, repoPath: string, proposalId: string): Card[];
  apply(projectId: string, repoPath: string, proposalId: string): Card[];
  getProposal(projectId: string, proposalId: string): PlanningProposal | null;
};

export function createPlanner(
  boardStore: BoardStore,
  runtimeStore: QueenBeeRuntimeStore,
  integrationManager: IntegrationManager,
  modelCaller: DeviseModelCaller = createDeviseModelCaller(PLANNER_TOOLS)
): Planner {
  return {
    async propose(projectId, repoPath, proposedRequirements, guidance) {
      const currentCards = boardStore.getBoard(projectId, repoPath).cards;
      const sharedContext = projectContext(projectId, repoPath);
      const messages: Message[] = [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildProposalPrompt(
            proposedRequirements,
            currentCards,
            sharedContext,
            guidance
          ),
        },
      ];
      const result = await callWithToolLoop(modelCaller, messages, repoPath);
      const changes = parseChanges(result, currentCards);
      const proposal: PlanningProposal = {
        id: randomUUID(),
        projectId,
        status: "pending",
        baseRequirementsRevision: requirementsRevision(
          readRequirements(repoPath)
        ),
        proposedRequirements,
        changes,
        createdAt: new Date().toISOString(),
      };
      runtimeStore.savePlanningProposal(proposal);
      return proposal;
    },

    decide(projectId, proposalId, changeId, decision) {
      const proposal = requireProposal(runtimeStore, projectId, proposalId);
      if (proposal.status !== "pending") {
        throw new Error("Planning proposal has already been applied");
      }
      const change = proposal.changes.find((item) => item.id === changeId);
      if (!change) throw new Error(`Planning change not found: ${changeId}`);
      if (change.action === "keep") {
        throw new Error("Unchanged cards do not require a decision");
      }
      change.decision = decision;
      runtimeStore.savePlanningProposal(proposal);
      return proposal;
    },

    acceptAll(projectId, repoPath, proposalId) {
      const proposal = requireProposal(runtimeStore, projectId, proposalId);
      for (const change of proposal.changes) {
        change.decision = "accepted";
      }
      runtimeStore.savePlanningProposal(proposal);
      return applyProposal(
        boardStore,
        runtimeStore,
        integrationManager,
        repoPath,
        proposal
      );
    },

    apply(projectId, repoPath, proposalId) {
      return applyProposal(
        boardStore,
        runtimeStore,
        integrationManager,
        repoPath,
        requireProposal(runtimeStore, projectId, proposalId)
      );
    },

    getProposal(projectId, proposalId) {
      return runtimeStore.getPlanningProposal(projectId, proposalId);
    },
  };
}

async function callWithToolLoop(
  modelCaller: DeviseModelCaller,
  messages: Message[],
  workspacePath: string,
  maxToolRounds = 10
): Promise<string> {
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await modelCaller.call(messages, workspacePath, true);
    if (response.toolCalls.length === 0) return response.content;

    for (const toolCall of response.toolCalls) {
      const result = executeDeviseTool(toolCall, workspacePath);
      messages.push(
        {
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
        },
        {
          role: "tool",
          content: result.content,
          tool_call_id: toolCall.id,
        }
      );
    }
  }
  throw new Error("Planner Agent reached the maximum tool-call limit");
}

function buildProposalPrompt(
  proposedRequirements: string,
  currentCards: Card[],
  sharedContext: unknown,
  guidance?: string
): string {
  return [
    "Reconcile every current card against the proposed project requirements.",
    "Proposed requirements:",
    proposedRequirements,
    "Current cards:",
    JSON.stringify(currentCards.map(cardContext), null, 2),
    "Shared Project Context:",
    JSON.stringify(sharedContext, null, 2),
    guidance ? `User guidance:\n${guidance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function projectContext(projectId: string, repoPath: string): unknown {
  try {
    return loadProjectContext(projectId, repoPath);
  } catch {
    return { unavailable: true };
  }
}

function cardContext(card: Card) {
  return {
    id: card.id,
    column: card.column,
    title: card.title,
    description: card.description,
    acceptanceCriteria: card.acceptanceCriteria,
    relevantFiles: card.relevantFiles,
    dependencies: card.dependencies,
    requirementRefs: card.requirementRefs ?? [],
  };
}

function parseChanges(content: string, currentCards: Card[]): PlanningChange[] {
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error("Planner Agent did not submit JSON changes");
  const parsed: unknown = JSON.parse(match[1]);
  const rawChanges = Array.isArray(parsed)
    ? parsed.map((proposedCard) => ({ action: "create", proposedCard }))
    : isRecord(parsed) && Array.isArray(parsed.changes)
      ? parsed.changes
      : null;
  if (!rawChanges) throw new Error("Planner Agent output has no changes array");

  const changes = rawChanges.map((value, index) =>
    parseChange(value, index, currentCards)
  );
  const addressed = new Set(
    changes.flatMap((change) => (change.cardId ? [change.cardId] : []))
  );
  for (const card of currentCards) {
    if (!addressed.has(card.id)) {
      throw new Error(`Planner Agent did not reconcile card '${card.id}'`);
    }
  }
  return changes;
}

function parseChange(
  value: unknown,
  index: number,
  currentCards: Card[]
): PlanningChange {
  if (!isRecord(value)) throw new Error("Planning change must be an object");
  const action = value.action;
  if (!isAction(action)) throw new Error("Planning change action is invalid");
  const cardId = typeof value.cardId === "string" ? value.cardId : undefined;
  const current = cardId
    ? currentCards.find((card) => card.id === cardId)
    : undefined;
  if (action !== "create" && !current) {
    throw new Error(
      `Planning change references unknown card '${cardId ?? ""}'`
    );
  }
  if (
    current &&
    ["in_progress", "reviewing", "done"].includes(current.column) &&
    action !== "keep"
  ) {
    throw new Error(
      `Planner Agent may not ${action} ${current.column} card '${current.id}'; create a follow-up card instead`
    );
  }
  const proposedCard =
    action === "create" || action === "update"
      ? parseCardSpecification(value.proposedCard)
      : undefined;
  return {
    id: `change-${String(index)}`,
    action,
    ...(cardId ? { cardId } : {}),
    ...(proposedCard ? { proposedCard } : {}),
    rationale:
      typeof value.rationale === "string" ? value.rationale : "No rationale",
    decision: action === "keep" ? "accepted" : "pending",
  };
}

function parseCardSpecification(value: unknown): CardSpecification {
  if (!isRecord(value)) throw new Error("Proposed card is required");
  const title = requiredString(value.title, "title");
  const description = requiredString(value.description, "description");
  const acceptanceCriteria = stringArray(value.acceptanceCriteria);
  const relevantFiles = stringArray(value.relevantFiles);
  const dependencies = stringArray(value.dependencies);
  const requirementRefs = stringArray(value.requirementRefs ?? []);
  if (acceptanceCriteria.length === 0 || relevantFiles.length === 0) {
    throw new Error(
      `Proposed card '${title}' requires acceptance criteria and relevant files`
    );
  }
  return {
    title,
    description,
    acceptanceCriteria,
    relevantFiles,
    dependencies,
    requirementRefs,
  };
}

function applyProposal(
  boardStore: BoardStore,
  runtimeStore: QueenBeeRuntimeStore,
  integrationManager: IntegrationManager,
  repoPath: string,
  proposal: PlanningProposal
): Card[] {
  if (proposal.status !== "pending") {
    throw new Error("Planning proposal has already been applied");
  }
  if (proposal.changes.some((change) => change.decision === "pending")) {
    throw new Error("Every proposed card change requires a decision");
  }
  if (
    requirementsRevision(readRequirements(repoPath)) !==
    proposal.baseRequirementsRevision
  ) {
    throw new Error("Canonical requirements changed after planning started");
  }

  const currentCards = boardStore.getBoard(proposal.projectId, repoPath).cards;
  const currentRequirements = readRequirements(repoPath);
  const byId = new Map(currentCards.map((card) => [card.id, card]));
  const result: Card[] = [];
  for (const change of proposal.changes) {
    if (change.action === "create") {
      if (change.decision === "accepted" && change.proposedCard) {
        result.push(newCard(change.proposedCard));
      }
      continue;
    }
    const current = change.cardId ? byId.get(change.cardId) : undefined;
    if (!current) continue;
    if (change.decision === "rejected" || change.action === "keep") {
      result.push(current);
    } else if (change.action === "update" && change.proposedCard) {
      result.push({ ...current, ...change.proposedCard });
    } else if (change.action === "remove") {
      result.push({ ...current, archivedAt: new Date().toISOString() });
    }
  }

  try {
    writeRequirements(repoPath, proposal.proposedRequirements);
    boardStore.saveCards(proposal.projectId, repoPath, result);
    integrationManager.commitPlanningSnapshot(repoPath, proposal.id);
  } catch (error) {
    writeRequirements(repoPath, currentRequirements);
    boardStore.saveCards(proposal.projectId, repoPath, currentCards);
    throw error;
  }
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  runtimeStore.savePlanningProposal(proposal);
  return result.filter((card) => !card.archivedAt);
}

function newCard(specification: CardSpecification): Card {
  return {
    id: generateId(),
    ...specification,
    requirementRefs: specification.requirementRefs ?? [],
    column: "idea",
    createdAt: new Date().toISOString(),
  };
}

function requireProposal(
  runtimeStore: QueenBeeRuntimeStore,
  projectId: string,
  proposalId: string
): PlanningProposal {
  const proposal = runtimeStore.getPlanningProposal(projectId, proposalId);
  if (!proposal) throw new Error(`Planning proposal not found: ${proposalId}`);
  return proposal;
}

function isAction(value: unknown): value is PlanningChange["action"] {
  return ["keep", "create", "update", "remove"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Proposed card ${name} is required`);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Proposed card list fields must be string arrays");
  }
  return value;
}
