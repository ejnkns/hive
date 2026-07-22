import { EventEmitter } from "node:events";
import type {
  Board,
  Card,
  Column,
  Idea,
  PlanningOutcome,
  WorkerHandover,
} from "shared/board-types";
import type { ProjectIntegrationStatus } from "shared/project-types";
import type { QueenBeeEvent } from "shared/queen-bee-events";

const bus = new EventEmitter<{ event: [QueenBeeEvent] }>();

function emit(event: QueenBeeEvent): void {
  bus.emit("event", event);
}

let versionCounter = 0;

function nextVersion(): number {
  return ++versionCounter;
}

export function onQueenBeeEvent(
  listener: (event: QueenBeeEvent) => void
): void {
  bus.on("event", listener);
}

export function offQueenBeeEvent(
  listener: (event: QueenBeeEvent) => void
): void {
  bus.off("event", listener);
}

export function emitBoardSnapshot(board: Board): void {
  emit({ type: "board_snapshot", version: nextVersion(), board });
}

export function emitCardMoved(cardId: string, column: Column): void {
  emit({ type: "card_moved", version: nextVersion(), cardId, column });
}

export function emitCardWorkerProgress(
  cardId: string,
  iteration: number,
  toolCalls: Array<{ name: string; args: string }>,
  content?: string
): void {
  emit({
    type: "card_worker_progress",
    version: nextVersion(),
    cardId,
    iteration,
    toolCalls,
    content,
  });
}

export function emitCardReviewComplete(
  cardId: string,
  verdict: "approved" | "changes_requested"
): void {
  emit({
    type: "card_review_complete",
    version: nextVersion(),
    cardId,
    verdict,
  });
}

export function emitCardAccepted(cardId: string): void {
  emit({ type: "card_accepted", version: nextVersion(), cardId });
}

export function emitCardChangesRequested(cardId: string): void {
  emit({ type: "card_changes_requested", version: nextVersion(), cardId });
}

export function emitCardUnfulfillable(
  cardId: string,
  handover: WorkerHandover
): void {
  emit({
    type: "card_unfulfillable",
    version: nextVersion(),
    cardId,
    handover,
  });
}

export function emitCardsCreated(cardIds: string[]): void {
  emit({ type: "cards_created", version: nextVersion(), cardIds });
}

export function emitIdeasChanged(ideas: Idea[]): void {
  emit({ type: "ideas_changed", version: nextVersion(), ideas });
}

export function emitDraftUpdated(
  scope: "project" | "card" | "idea",
  scopeId: string | undefined,
  content: string
): void {
  emit({
    type: "draft_updated",
    version: nextVersion(),
    scope,
    scopeId,
    content,
  });
}

export function emitDraftFinalized(
  scope: "project" | "card" | "idea",
  scopeId: string | undefined,
  content: string
): void {
  emit({
    type: "draft_finalized",
    version: nextVersion(),
    scope,
    scopeId,
    content,
  });
}

export function emitPlanningOutcome(outcome: PlanningOutcome): void {
  emit({ type: "planning_outcome", version: nextVersion(), outcome });
}

export function emitIntegrationChanged(status: ProjectIntegrationStatus): void {
  emit({ type: "integration_changed", version: nextVersion(), status });
}

export function emitProjectsChanged(): void {
  emit({ type: "projects_changed", version: nextVersion() });
}

// Keep old exports for backward compat during migration
import type { RequirementsDraftUpdate } from "./devise-engine";
import type { WorkerEvent } from "./worker-supervisor";

export const workerEventBus = new EventEmitter<{
  event: [WorkerEvent, string];
}>();

export function emitWorkerEvent(event: WorkerEvent, projectId: string): void {
  workerEventBus.emit("event", event, projectId);
}

export const projectEventBus = new EventEmitter<{
  change: [string];
}>();

export function emitProjectEvent(projectId: string): void {
  projectEventBus.emit("change", projectId);
}

export const boardEventBus = new EventEmitter<{
  change: [string];
}>();

export function emitBoardEvent(projectId: string): void {
  boardEventBus.emit("change", projectId);
}

export const requirementsEventBus = new EventEmitter<{
  draft: [RequirementsDraftUpdate];
}>();

export function emitRequirementsDraft(update: RequirementsDraftUpdate): void {
  requirementsEventBus.emit("draft", update);
}
