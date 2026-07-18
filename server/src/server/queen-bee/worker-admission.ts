/** @public */

import type {
  WorkerAdmission,
  WorkerAdmissionBlocker,
} from "shared/board-types";
import type { Card } from "./board-store";

export function evaluateWorkerAdmission(input: {
  card: Card;
  cards: Card[];
  runningCardIds: string[];
  maxConcurrentWorkers: number;
  confirmRisks: boolean;
}): WorkerAdmission {
  const maxConcurrentWorkers = Math.max(1, input.maxConcurrentWorkers);
  const blockers = [
    ...dependencyBlockers(input.card, input.cards),
    ...fileOverlapBlockers(
      input.card,
      input.cards,
      new Set(input.runningCardIds)
    ),
    ...capacityBlockers(input.runningCardIds.length, maxConcurrentWorkers),
  ];
  const hasCapacityBlocker = blockers.some(
    (blocker) => blocker.kind === "capacity"
  );
  const hasOverridableBlocker = blockers.some(
    (blocker) => blocker.kind !== "capacity"
  );

  return {
    allowed:
      !hasCapacityBlocker && (!hasOverridableBlocker || input.confirmRisks),
    canOverride: hasOverridableBlocker && !hasCapacityBlocker,
    activeWorkers: input.runningCardIds.length,
    maxConcurrentWorkers,
    blockers,
  };
}

function dependencyBlockers(
  card: Card,
  cards: Card[]
): WorkerAdmissionBlocker[] {
  const cardsById = new Map(
    cards.map((candidate) => [candidate.id, candidate])
  );
  const unmet = card.dependencies.filter(
    (dependencyId) => cardsById.get(dependencyId)?.column !== "done"
  );
  if (unmet.length === 0) return [];
  return [
    {
      kind: "dependency",
      message: `Complete ${String(unmet.length)} dependency card(s) before starting this work`,
      cardIds: unmet,
    },
  ];
}

function fileOverlapBlockers(
  card: Card,
  cards: Card[],
  runningCardIds: Set<string>
): WorkerAdmissionBlocker[] {
  const targetFiles = new Set(card.relevantFiles.map(normalizeFile));
  const blockers: WorkerAdmissionBlocker[] = [];
  for (const activeCard of cards) {
    if (!runningCardIds.has(activeCard.id) || activeCard.id === card.id) {
      continue;
    }
    const files = activeCard.relevantFiles
      .map(normalizeFile)
      .filter((file) => targetFiles.has(file));
    if (files.length === 0) continue;
    blockers.push({
      kind: "file_overlap",
      message: `Active card '${activeCard.title}' shares relevant files with this work`,
      cardIds: [activeCard.id],
      files: [...new Set(files)].sort(),
    });
  }
  return blockers;
}

function capacityBlockers(
  activeWorkers: number,
  maxConcurrentWorkers: number
): WorkerAdmissionBlocker[] {
  if (activeWorkers < maxConcurrentWorkers) return [];
  return [
    {
      kind: "capacity",
      message: `Project worker capacity is ${String(maxConcurrentWorkers)}`,
      cardIds: [],
    },
  ];
}

function normalizeFile(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}
