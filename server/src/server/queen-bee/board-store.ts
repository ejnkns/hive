/** @public */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Card as SharedCard,
  Column as SharedColumn,
} from "shared/board-types";
import { generateId } from "shared/generate-id";
import { loadBoard } from "./board-store/load-board";
import { saveBoard } from "./board-store/save-board";
import { saveCard } from "./board-store/save-card";

export type Column = SharedColumn;

export const COLUMNS: Column[] = [
  "idea",
  "ready",
  "in_progress",
  "reviewing",
  "done",
  "unfulfillable",
];

export type Card = SharedCard;

export type Board = {
  projectId: string;
  cards: Card[];
};

export type BoardStore = {
  getBoard(projectId: string, repoPath: string): Board;
  addCard(
    projectId: string,
    repoPath: string,
    card: Omit<Card, "id" | "createdAt">
  ): Card;
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
  onBoardChanged: (projectId: string) => void
): BoardStore {
  return {
    getBoard(projectId: string, repoPath: string): Board {
      return visibleBoard(loadBoard(projectId, repoPath));
    },

    addCard(
      projectId: string,
      repoPath: string,
      card: Omit<Card, "id" | "createdAt">
    ): Card {
      const board = loadBoard(projectId, repoPath);
      const newCard: Card = {
        ...card,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };

      board.cards.push(newCard);
      ensureHiveDir(repoPath);
      saveBoard(repoPath, board);
      saveCard(repoPath, newCard);
      onBoardChanged(projectId);

      return newCard;
    },

    moveCard(
      projectId: string,
      repoPath: string,
      cardId: string,
      column: Column
    ): Card {
      const board = loadBoard(projectId, repoPath);
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      card.column = column;
      saveBoard(repoPath, board);
      saveCard(repoPath, card);
      onBoardChanged(projectId);

      return card;
    },

    updateCard(projectId, repoPath, cardId, patch) {
      const board = loadBoard(projectId, repoPath);
      const card = board.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      Object.assign(card, patch, { id: card.id, createdAt: card.createdAt });
      saveBoard(repoPath, board);
      saveCard(repoPath, card);
      onBoardChanged(projectId);
      return card;
    },

    archiveCard(projectId, repoPath, cardId) {
      const board = loadBoard(projectId, repoPath);
      const card = board.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);

      card.archivedAt = new Date().toISOString();
      saveBoard(repoPath, board);
      saveCard(repoPath, card);
      onBoardChanged(projectId);
      return card;
    },

    saveCards(projectId: string, repoPath: string, cards: Card[]): void {
      ensureHiveDir(repoPath);
      const archivedCards = loadBoard(projectId, repoPath).cards.filter(
        (card) => card.archivedAt
      );
      const board: Board = { projectId, cards: [...cards, ...archivedCards] };
      saveBoard(repoPath, board);
      for (const card of cards) {
        saveCard(repoPath, card);
      }
      onBoardChanged(projectId);
    },
  };
}

function visibleBoard(board: Board): Board {
  return { ...board, cards: board.cards.filter((card) => !card.archivedAt) };
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
