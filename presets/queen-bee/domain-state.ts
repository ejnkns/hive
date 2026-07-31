import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// === QUEEN BEE DOMAIN STATE ===
//
// The authoritative domain state lives under `.hive/` in the flow's base
// directory (the bound repo root when a repo is present): requirements.md,
// draft.md, board.json, cards/<id>.json, reviews/<id>.json. Operational
// workflow state (currentState, taskOutputs) lives separately in ~/.hive/flows/.
// These helpers are the only way the preset touches domain state files.

export type BoardCardStatus =
  | "ready"
  | "in_progress"
  | "reviewing"
  | "done"
  | "unfulfillable";

export type BoardCard = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: BoardCardStatus;
  dependsOn: string[];
  createdAt: string;
};

export type BoardIdea = {
  id: string;
  title: string;
  brief: string;
  status: "backlog" | "refined" | "archived";
};

export type Board = {
  cards: BoardCard[];
  ideas: BoardIdea[];
};

export type CardSpec = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
};

export type ReviewPackage = {
  packageId: string;
  cardId: string;
  attempt: number;
  spec: CardSpec;
  requirements: string;
  baseCommit: string;
  workerHead: string;
  diff: string;
  createdAt: string;
};

// ── Board ──

function hiveDir(basePath: string): string {
  return join(basePath, ".hive");
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeFile(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

export function readBoard(basePath: string): Board {
  return readJson(join(hiveDir(basePath), "board.json"), {
    cards: [],
    ideas: [],
  });
}

export function writeBoard(basePath: string, board: Board): string {
  return writeFile(
    hiveDir(basePath),
    "board.json",
    JSON.stringify(board, null, 2)
  );
}

export function upsertCard(basePath: string, card: BoardCard): void {
  const board = readBoard(basePath);
  const idx = board.cards.findIndex((c) => c.id === card.id);
  if (idx >= 0) board.cards[idx] = card;
  else board.cards.push(card);
  writeBoard(basePath, board);
}

export function updateCardStatus(
  basePath: string,
  cardId: string,
  status: BoardCardStatus
): void {
  const board = readBoard(basePath);
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.status = status;
  writeBoard(basePath, board);
}

// ── Requirements ──

export function readRequirements(basePath: string): string {
  const path = join(hiveDir(basePath), "requirements.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function writeRequirements(basePath: string, content: string): string {
  return writeFile(hiveDir(basePath), "requirements.md", content);
}

export function readDraft(basePath: string): string {
  const path = join(hiveDir(basePath), "draft.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function writeDraft(basePath: string, content: string): string {
  return writeFile(hiveDir(basePath), "draft.md", content);
}

// ── Review packages ──

export function writeReviewPackage(
  basePath: string,
  pkg: ReviewPackage
): string {
  return writeFile(
    join(hiveDir(basePath), "reviews"),
    `${pkg.cardId}-${pkg.attempt}.json`,
    JSON.stringify(pkg, null, 2)
  );
}
