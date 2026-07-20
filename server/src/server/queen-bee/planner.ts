/** @public */

import { createHash, randomUUID } from "node:crypto";
import type {
  CardSpecification,
  Idea,
  PlanningChange,
  PlanningOutcome,
  PlanningProposal,
  PlanningRunKind,
  RequirementsFeedback,
} from "shared/board-types";
import { generateId } from "shared/generate-id";
import type { Message } from "shared/message";
import type { Board, BoardStore, Card } from "./board-store";
import {
  type AgentModelCaller,
  createAgentModelCaller,
} from "./devise-engine/create-devise-model-caller";
import { AGENT_TOOLS, executeAgentTool } from "./devise-engine/devise-tools";
import type { IntegrationManager } from "./integration-manager";
import { PLAN_SYSTEM_PROMPT } from "./planner/plan-system-prompt";
import { loadProjectContext, type ProjectContext } from "./project-context";
import type { QueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import {
  readRequirements,
  requirementsRevision,
  writeRequirements,
} from "./requirements-store";

export type PlanningManager = {
  propose(
    projectId: string,
    repoPath: string,
    proposedRequirements: string,
    guidance?: string,
    disposition?: PlanningDisposition
  ): Promise<PlanningOutcome>;
  decide(
    projectId: string,
    proposalId: string,
    changeId: string,
    decision: "accepted" | "rejected"
  ): PlanningProposal;
  acceptAll(projectId: string, repoPath: string, proposalId: string): Card[];
  apply(projectId: string, repoPath: string, proposalId: string): Card[];
  getProposal(projectId: string, proposalId: string): PlanningProposal | null;
  getRequirementsFeedback(
    projectId: string,
    feedbackId: string
  ): RequirementsFeedback | null;
  getOpenOutcome(projectId: string): PlanningOutcome | null;
  resolveRequirementsFeedback(
    projectId: string,
    feedbackId: string
  ): RequirementsFeedback;
  cancelProposal(projectId: string, proposalId: string): PlanningProposal;
};

export type PlanningDisposition =
  | {
      cardId: string;
      target: "ready" | "archived";
    }
  | {
      ideaId: string;
      target: "resolved";
    }
  | {
      proposalId: string;
      target: "replanned";
    };

export function createPlanningManager(
  boardStore: BoardStore,
  runtimeStore: QueenBeeRuntimeStore,
  integrationManager: IntegrationManager,
  modelCaller: AgentModelCaller = createAgentModelCaller(PLANNER_TOOLS)
): PlanningManager {
  return {
    async propose(
      projectId,
      repoPath,
      proposedRequirements,
      guidance,
      disposition
    ) {
      const currentBoard = boardStore.getBoard(projectId, repoPath);
      const currentCards = currentBoard.cards;
      const sharedContext = projectContext(projectId, repoPath);
      const currentRequirements = readRequirements(repoPath);
      const previousProposal =
        disposition && "proposalId" in disposition
          ? requireProposal(runtimeStore, projectId, disposition.proposalId)
          : undefined;
      if (
        previousProposal?.status !== undefined &&
        previousProposal.status !== "pending"
      ) {
        throw new Error("Only a pending Planning Proposal can be replanned");
      }
      const runKind = planningRunKind(currentBoard, disposition);
      const messages: Message[] = [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildProposalPrompt(
            proposedRequirements,
            currentRequirements,
            currentCards,
            currentBoard.ideas,
            sharedContext,
            guidance,
            disposition,
            previousProposal
          ),
        },
      ];
      const result = await callWithToolLoop(
        modelCaller,
        messages,
        repoPath,
        "revision" in sharedContext ? sharedContext.revision : undefined
      );
      const feedbackIssues = parseRequirementsFeedback(result);
      if (feedbackIssues) {
        const feedback: RequirementsFeedback = {
          kind: "requirements_feedback",
          id: randomUUID(),
          projectId,
          status: "pending",
          projectRevision:
            "revision" in sharedContext ? sharedContext.revision : null,
          baseRequirementsRevision: requirementsRevision(currentRequirements),
          baseBoardRevision: boardRevision(currentBoard),
          proposedRequirements,
          ...(disposition && "ideaId" in disposition
            ? { sourceIdeaId: disposition.ideaId }
            : previousProposal?.sourceIdeaId
              ? { sourceIdeaId: previousProposal.sourceIdeaId }
              : {}),
          issues: feedbackIssues,
          createdAt: new Date().toISOString(),
        };
        runtimeStore.saveRequirementsFeedback(feedback);
        return feedback;
      }
      const changes = parseChanges(result, currentCards);
      if (
        runKind === "initial_planning" &&
        !changes.some((change) => change.action === "create")
      ) {
        throw new Error("Initial planning must create at least one Ready Card");
      }
      if (disposition && "cardId" in disposition) {
        markCardDisposition(changes, disposition);
      }
      const sourceIdeaId =
        disposition && "ideaId" in disposition
          ? disposition.ideaId
          : previousProposal?.sourceIdeaId;
      if (sourceIdeaId) {
        if (!currentBoard.ideas.some((idea) => idea.id === sourceIdeaId)) {
          throw new Error(`Source Idea not found: ${sourceIdeaId}`);
        }
        markIdeaResolution(changes, sourceIdeaId, currentCards);
      }
      const proposal: PlanningProposal = {
        id: randomUUID(),
        projectId,
        status: "pending",
        baseRequirementsRevision: requirementsRevision(
          readRequirements(repoPath)
        ),
        baseBoardRevision: boardRevision(currentBoard),
        projectRevision:
          "revision" in sharedContext ? sharedContext.revision : null,
        runKind,
        ...(sourceIdeaId ? { sourceIdeaId } : {}),
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
      if (change.action === "keep" && !change.resolvesSourceIdea) {
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

    getRequirementsFeedback(projectId, feedbackId) {
      return runtimeStore.getRequirementsFeedback(projectId, feedbackId);
    },

    getOpenOutcome(projectId) {
      const outcomes: PlanningOutcome[] = [
        ...runtimeStore
          .getPlanningProposals(projectId)
          .filter((proposal) => proposal.status === "pending"),
        ...runtimeStore
          .getRequirementsFeedbacks(projectId)
          .filter((feedback) => feedback.status !== "resolved"),
      ];
      return (
        outcomes
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .at(-1) ?? null
      );
    },

    resolveRequirementsFeedback(projectId, feedbackId) {
      const feedback = runtimeStore.getRequirementsFeedback(
        projectId,
        feedbackId
      );
      if (!feedback) {
        throw new Error(`Requirements Feedback not found: ${feedbackId}`);
      }
      feedback.status = "resolved";
      feedback.resolvedAt = new Date().toISOString();
      runtimeStore.saveRequirementsFeedback(feedback);
      return feedback;
    },

    cancelProposal(projectId, proposalId) {
      const proposal = requireProposal(runtimeStore, projectId, proposalId);
      if (proposal.status !== "pending") {
        throw new Error("Only a pending Planning Proposal can be cancelled");
      }
      proposal.status = "cancelled";
      runtimeStore.savePlanningProposal(proposal);
      return proposal;
    },
  };
}

const PLANNER_TOOLS = AGENT_TOOLS.filter((tool) =>
  ["list_directory", "read_file", "search_code"].includes(tool.function.name)
);

async function callWithToolLoop(
  modelCaller: AgentModelCaller,
  messages: Message[],
  workspacePath: string,
  projectRevision?: string,
  maxToolRounds = 10
): Promise<string> {
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await modelCaller.call(messages, workspacePath, true);
    if (response.toolCalls.length === 0) return response.content;

    for (const toolCall of response.toolCalls) {
      const result = executeAgentTool(toolCall, workspacePath, projectRevision);
      const assistantMessage: Message = {
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
      };
      if (response.reasoningContent) {
        assistantMessage.reasoning_content = response.reasoningContent;
      }
      if (response.reasoning) {
        assistantMessage.reasoning = response.reasoning;
      }
      messages.push(assistantMessage, {
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      });
    }
  }
  throw new Error("Planner Agent reached the maximum tool-call limit");
}

function buildProposalPrompt(
  proposedRequirements: string,
  currentRequirements: string,
  currentCards: Card[],
  currentIdeas: Idea[],
  sharedContext: unknown,
  guidance?: string,
  disposition?: PlanningDisposition,
  previousProposal?: PlanningProposal
): string {
  return [
    "Reconcile every current card against the proposed project requirements.",
    "Canonical requirements:",
    currentRequirements || "(none)",
    "Proposed requirements:",
    proposedRequirements,
    "Deterministic requirements diff:",
    requirementsDiff(currentRequirements, proposedRequirements),
    "Current cards:",
    JSON.stringify(currentCards.map(cardContext), null, 2),
    "Unresolved ideas:",
    JSON.stringify(currentIdeas, null, 2),
    disposition && "ideaId" in disposition
      ? `Resolve source idea '${disposition.ideaId}'. Mark every change that represents it with resolvesSourceIdea: true. At least one existing or created Card must represent the Idea.`
      : "",
    previousProposal
      ? `Rejected Planning Proposal artifact:\n${JSON.stringify(previousProposal, null, 2)}`
      : "",
    "Shared Project Context:",
    JSON.stringify(sharedContext, null, 2),
    guidance ? `User guidance:\n${guidance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function projectContext(
  projectId: string,
  repoPath: string
): ProjectContext | { unavailable: true } {
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
  if (addressed.size !== changes.filter((change) => change.cardId).length) {
    throw new Error("Planner Agent must reconcile every Card exactly once");
  }
  validateDependencyGraph(changes, currentCards);
  return changes;
}

function validateDependencyGraph(
  changes: PlanningChange[],
  currentCards: Card[]
): void {
  const currentById = new Map(currentCards.map((card) => [card.id, card]));
  const graph = new Map<string, string[]>();
  for (const change of changes) {
    if (change.action === "remove") continue;
    const nodeId = change.action === "create" ? change.id : change.cardId;
    if (!nodeId) continue;
    const dependencies =
      change.proposedCard?.dependencies ??
      (change.cardId
        ? currentById.get(change.cardId)?.dependencies
        : undefined) ??
      [];
    graph.set(nodeId, dependencies);
  }

  for (const [nodeId, dependencies] of graph) {
    for (const dependencyId of dependencies) {
      if (!graph.has(dependencyId)) {
        throw new Error(
          `Planning dependency '${dependencyId}' for '${nodeId}' does not reference an active Card or created change`
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string): void {
    if (visiting.has(nodeId)) {
      throw new Error("Planning dependencies must form a DAG");
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependencyId of graph.get(nodeId) ?? []) visit(dependencyId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of graph.keys()) visit(nodeId);
}

function parseRequirementsFeedback(
  content: string
): RequirementsFeedback["issues"] | null {
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  const parsed: unknown = JSON.parse(match[1]);
  if (!isRecord(parsed) || !Array.isArray(parsed.requirementsFeedback)) {
    return null;
  }
  if ("changes" in parsed) {
    throw new Error(
      "Planner Agent must return either Requirements Feedback or Card changes, not both"
    );
  }
  if (parsed.requirementsFeedback.length === 0) {
    throw new Error("Requirements Feedback must contain at least one issue");
  }
  return parsed.requirementsFeedback.map((value) => {
    if (!isRecord(value)) {
      throw new Error("Requirements Feedback issue must be an object");
    }
    const category = value.category;
    if (!isFeedbackCategory(category)) {
      throw new Error("Requirements Feedback category is invalid");
    }
    return {
      requirementRefs: stringArray(value.requirementRefs ?? []),
      category,
      explanation: requiredString(value.explanation, "feedback explanation"),
      evidence: stringArray(value.evidence ?? []),
      decisionNeeded: requiredString(
        value.decisionNeeded,
        "feedback decisionNeeded"
      ),
      recommendation: requiredString(
        value.recommendation,
        "feedback recommendation"
      ),
    };
  });
}

function isFeedbackCategory(
  value: unknown
): value is RequirementsFeedback["issues"][number]["category"] {
  return [
    "contradiction",
    "missing_decision",
    "unobservable_acceptance",
    "constraint_conflict",
    "scope_loss",
    "insufficient_detail",
  ].includes(String(value));
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
  const resolvesSourceIdea = value.resolvesSourceIdea === true;
  return {
    id: `change-${String(index)}`,
    action,
    ...(cardId ? { cardId } : {}),
    ...(proposedCard ? { proposedCard } : {}),
    rationale:
      typeof value.rationale === "string" ? value.rationale : "No rationale",
    decision: action === "keep" && !resolvesSourceIdea ? "accepted" : "pending",
    resolvesSourceIdea,
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
  if (proposal.changes.some((change) => change.decision === "rejected")) {
    throw new Error(
      "Rejected card changes require a revised requirements and planning proposal"
    );
  }
  if (
    requirementsRevision(readRequirements(repoPath)) !==
    proposal.baseRequirementsRevision
  ) {
    throw new Error("Canonical requirements changed after planning started");
  }
  if (proposal.projectRevision !== null) {
    let currentProjectRevision: string;
    try {
      currentProjectRevision = loadProjectContext(
        proposal.projectId,
        repoPath
      ).revision;
    } catch {
      throw new Error("Could not verify the Project revision");
    }
    if (currentProjectRevision !== proposal.projectRevision) {
      throw new Error("Project revision changed after planning started");
    }
  }

  const currentBoard = boardStore.getBoard(proposal.projectId, repoPath);
  const currentCards = currentBoard.cards;
  if (boardRevision(currentBoard) !== proposal.baseBoardRevision) {
    throw new Error("Board cards changed after planning started");
  }
  const currentRequirements = readRequirements(repoPath);
  const byId = new Map(currentCards.map((card) => [card.id, card]));
  const createdCardIds = new Map(
    proposal.changes
      .filter((change) => change.action === "create")
      .map((change) => [change.id, generateId()])
  );
  const resolveDependencies = (dependencies: string[]) =>
    dependencies.map(
      (dependencyId) => createdCardIds.get(dependencyId) ?? dependencyId
    );
  const result: Card[] = [];
  for (const change of proposal.changes) {
    if (change.action === "create") {
      if (change.decision === "accepted" && change.proposedCard) {
        result.push(
          newCard(
            {
              ...change.proposedCard,
              dependencies: resolveDependencies(
                change.proposedCard.dependencies
              ),
            },
            createdCardIds.get(change.id) ?? generateId(),
            change.resolvesSourceIdea ? proposal.sourceIdeaId : undefined
          )
        );
      }
      continue;
    }
    const current = change.cardId ? byId.get(change.cardId) : undefined;
    if (!current) continue;
    if (change.action === "keep") {
      result.push(withIdeaOrigin(current, change, proposal.sourceIdeaId));
    } else if (change.action === "update" && change.proposedCard) {
      result.push(
        withIdeaOrigin(
          {
            ...current,
            ...change.proposedCard,
            dependencies: resolveDependencies(change.proposedCard.dependencies),
            ...(change.targetColumn === "ready"
              ? {
                  column: change.targetColumn,
                  handover: undefined,
                  coordinatorLog: undefined,
                }
              : {}),
          },
          change,
          proposal.sourceIdeaId
        )
      );
    } else if (change.action === "remove") {
      result.push({ ...current, archivedAt: new Date().toISOString() });
    }
  }

  try {
    writeRequirements(repoPath, proposal.proposedRequirements);
    boardStore.saveCards(proposal.projectId, repoPath, result);
    if (proposal.sourceIdeaId) {
      boardStore.saveIdeas(
        proposal.projectId,
        repoPath,
        currentBoard.ideas.map((idea) =>
          idea.id === proposal.sourceIdeaId
            ? { ...idea, archivedAt: new Date().toISOString() }
            : idea
        )
      );
    }
    integrationManager.commitPlanningSnapshot(repoPath, proposal.id);
  } catch (error) {
    writeRequirements(repoPath, currentRequirements);
    boardStore.saveCards(proposal.projectId, repoPath, currentCards);
    boardStore.saveIdeas(proposal.projectId, repoPath, currentBoard.ideas);
    throw error;
  }
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  runtimeStore.savePlanningProposal(proposal);
  return result.filter((card) => !card.archivedAt);
}

function markCardDisposition(
  changes: PlanningChange[],
  disposition: Extract<PlanningDisposition, { cardId: string }>
): void {
  const change = changes.find(
    (candidate) => candidate.cardId === disposition.cardId
  );
  if (disposition.target === "ready") {
    if (change?.action !== "update" || !change.proposedCard) {
      throw new Error(
        `Planner Agent must update refined card '${disposition.cardId}' before it can move to Ready`
      );
    }
    change.targetColumn = "ready";
    return;
  }
  if (change?.action !== "remove") {
    throw new Error(
      `Planner Agent must remove archived card '${disposition.cardId}' from the active plan`
    );
  }
}

function boardRevision(board: Board): string {
  const specifications = board.cards
    .map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      acceptanceCriteria: card.acceptanceCriteria,
      relevantFiles: card.relevantFiles,
      dependencies: card.dependencies,
      requirementRefs: card.requirementRefs ?? [],
      column: card.column,
      archivedAt: card.archivedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256")
    .update(JSON.stringify({ ideas: board.ideas, cards: specifications }))
    .digest("hex");
}

function newCard(
  specification: CardSpecification,
  id: string,
  originIdeaId?: string
): Card {
  return {
    id,
    ...specification,
    requirementRefs: specification.requirementRefs ?? [],
    column: "ready",
    createdAt: new Date().toISOString(),
    ...(originIdeaId ? { originIdeaIds: [originIdeaId] } : {}),
  };
}

function withIdeaOrigin(
  card: Card,
  change: PlanningChange,
  sourceIdeaId?: string
): Card {
  if (!change.resolvesSourceIdea || !sourceIdeaId) return card;
  return {
    ...card,
    originIdeaIds: [...new Set([...(card.originIdeaIds ?? []), sourceIdeaId])],
  };
}

function markIdeaResolution(
  changes: PlanningChange[],
  ideaId: string,
  currentCards: Card[]
): void {
  const linkedChanges = changes.filter((change) => change.resolvesSourceIdea);
  if (linkedChanges.length === 0) {
    throw new Error(
      `Planner Agent must link Idea '${ideaId}' to at least one Card`
    );
  }
  if (linkedChanges.some((change) => change.action === "remove")) {
    throw new Error(
      `Planner Agent may only resolve Idea '${ideaId}' to a surviving Card`
    );
  }
  for (const change of linkedChanges) {
    if (change.action === "create") continue;
    const card = currentCards.find(
      (candidate) => candidate.id === change.cardId
    );
    if (card?.column !== "ready") {
      throw new Error(
        `Planner Agent may only resolve Idea '${ideaId}' to a Ready Card`
      );
    }
  }
}

function planningRunKind(
  board: Board,
  disposition?: PlanningDisposition
): PlanningRunKind {
  if (disposition && "ideaId" in disposition) return "idea_resolution";
  if (disposition && "proposalId" in disposition) return "card_replanning";
  return board.cards.length === 0
    ? "initial_planning"
    : "requirements_reconciliation";
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

function requirementsDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const removed = beforeLines
    .slice(start, beforeEnd)
    .map((line) => `- ${line}`);
  const added = afterLines.slice(start, afterEnd).map((line) => `+ ${line}`);
  return [...removed, ...added].join("\n") || "(no changes)";
}
