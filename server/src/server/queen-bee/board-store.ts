/** @public */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Idea,
  Card as SharedCard,
  Column as SharedColumn,
} from "shared/board-types";
import { generateId } from "shared/generate-id";
import { loadBoard } from "./board-store/load-board";
import { saveBoard } from "./board-store/save-board";
import { saveCard } from "./board-store/save-card";
import type {
  CardRuntimeState,
  QueenBeeRuntimeStore,
} from "./queen-bee-runtime-store";
import { emitBoardSnapshot } from "./worker-event-bus";

export type Column = SharedColumn;

export const COLUMNS: Column[] = [
  "ready",
  "in_progress",
  "reviewing",
  "done",
  "unfulfillable",
];

export type Card = SharedCard;

export type Board = {
  projectId: string;
  ideas: Idea[];
  cards: Card[];
};

export type BoardStore = {
  getBoard(projectId: string, repoPath: string): Board;
  addCard(
    projectId: string,
    repoPath: string,
    card: Omit<Card, "id" | "createdAt">
  ): Card;
  addIdea(
    projectId: string,
    repoPath: string,
    idea: Pick<Idea, "title" | "brief">
  ): Idea;
  archiveIdea(projectId: string, repoPath: string, ideaId: string): Idea;
  saveIdeas(projectId: string, repoPath: string, ideas: Idea[]): void;
  moveCard(
    projectId: string,
    repoPath: string,
    cardId: string,
    column: Column
  ): Card;
  updateCard(
    projectId: string,
    repoPath: string,
    cardId: string,
    patch: Partial<Omit<Card, "id" | "createdAt">>
  ): Card;
  archiveCard(projectId: string, repoPath: string, cardId: string): Card;
  saveCards(projectId: string, repoPath: string, cards: Card[]): void;
};

export function createBoardStore(
  onBoardChanged: (projectId: string) => void,
  runtimeStore: QueenBeeRuntimeStore
): BoardStore {
  return {
    getBoard(projectId: string, repoPath: string): Board {
      return visibleBoard(loadBoard(projectId, repoPath, runtimeStore));
    },

    addCard(
      projectId: string,
      repoPath: string,
      card: Omit<Card, "id" | "createdAt">
    ): Card {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const newCard: Card = {
        ...card,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };

      board.cards.push(newCard);
      ensureHiveDir(repoPath);
      saveBoard(repoPath, board);
      saveCard(repoPath, newCard);
      saveRuntimeState(runtimeStore, projectId, newCard);
      onBoardChanged(projectId);
      emitBoardSnapshot(board);

      return newCard;
    },

    addIdea(projectId, repoPath, idea) {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const newIdea: Idea = {
        ...idea,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      runtimeStore.saveIdeas(projectId, [...board.ideas, newIdea]);
      onBoardChanged(projectId);
      emitBoardSnapshot(loadBoard(projectId, repoPath, runtimeStore));
      return newIdea;
    },

    archiveIdea(projectId, repoPath, ideaId) {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const idea = board.ideas.find((candidate) => candidate.id === ideaId);
      if (!idea) throw new Error(`Idea not found: ${ideaId}`);
      const archived = { ...idea, archivedAt: new Date().toISOString() };
      runtimeStore.saveIdeas(
        projectId,
        board.ideas.map((candidate) =>
          candidate.id === ideaId ? archived : candidate
        )
      );
      onBoardChanged(projectId);
      emitBoardSnapshot(loadBoard(projectId, repoPath, runtimeStore));
      return archived;
    },

    saveIdeas(projectId, _repoPath, ideas) {
      runtimeStore.saveIdeas(projectId, ideas);
      onBoardChanged(projectId);
      emitBoardSnapshot(loadBoard(projectId, _repoPath, runtimeStore));
    },

    moveCard(
      projectId: string,
      repoPath: string,
      cardId: string,
      column: Column
    ): Card {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      card.column = column;
      saveRuntimeState(runtimeStore, projectId, card);
      onBoardChanged(projectId);
      emitBoardSnapshot(board);

      return card;
    },

    updateCard(projectId, repoPath, cardId, patch) {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const card = board.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      Object.assign(card, patch, { id: card.id, createdAt: card.createdAt });
      if (changesSpecification(patch)) {
        ensureHiveDir(repoPath);
        saveBoard(repoPath, board);
        saveCard(repoPath, card);
      }
      saveRuntimeState(runtimeStore, projectId, card);
      onBoardChanged(projectId);
      emitBoardSnapshot(board);
      return card;
    },

    archiveCard(projectId, repoPath, cardId) {
      const board = loadBoard(projectId, repoPath, runtimeStore);
      const card = board.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      card.archivedAt = new Date().toISOString();
      saveRuntimeState(runtimeStore, projectId, card);
      onBoardChanged(projectId);
      emitBoardSnapshot(board);
      return card;
    },

    saveCards(projectId: string, repoPath: string, cards: Card[]): void {
      ensureHiveDir(repoPath);
      const archivedCards = loadBoard(
        projectId,
        repoPath,
        runtimeStore
      ).cards.filter((card) => card.archivedAt);
      const current = loadBoard(projectId, repoPath, runtimeStore);
      const board: Board = {
        projectId,
        ideas: current.ideas,
        cards: [...cards, ...archivedCards],
      };
      saveBoard(repoPath, board);
      for (const card of cards) {
        saveCard(repoPath, card);
        saveRuntimeState(runtimeStore, projectId, card);
      }
      onBoardChanged(projectId);
      emitBoardSnapshot(board);
    },
  };
}

function saveRuntimeState(
  runtimeStore: QueenBeeRuntimeStore,
  projectId: string,
  card: Card
): void {
  const state: CardRuntimeState = {
    column: card.column,
    workerLog: card.workerLog,
    reviewerLog: card.reviewerLog,
    handover: card.handover,
    coordinatorLog: card.coordinatorLog,
    workAttempts: card.workAttempts,
    archivedAt: card.archivedAt,
  };
  runtimeStore.saveCardState(projectId, card.id, state);
}

function changesSpecification(
  patch: Partial<Omit<Card, "id" | "createdAt">>
): boolean {
  return (
    "title" in patch ||
    "description" in patch ||
    "acceptanceCriteria" in patch ||
    "relevantFiles" in patch ||
    "dependencies" in patch ||
    "requirementRefs" in patch ||
    "originIdeaIds" in patch
  );
}

function visibleBoard(board: Board): Board {
  return {
    ...board,
    ideas: board.ideas.filter((idea) => !idea.archivedAt),
    cards: board.cards.filter((card) => !card.archivedAt),
  };
}

function ensureHiveDir(repoPath: string): void {
  const hiveDir = join(repoPath, ".hive");
  if (!existsSync(hiveDir)) {
    mkdirSync(hiveDir, { recursive: true });
  }
  const cardsDir = join(hiveDir, "cards");
  if (!existsSync(cardsDir)) {
    mkdirSync(cardsDir, { recursive: true });
  }
}
