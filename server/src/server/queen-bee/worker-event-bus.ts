import { EventEmitter } from "node:events";
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

export const reviewerEventBus = new EventEmitter<{
  verdict: [string, "pass" | "fail", string];
}>();

export function emitReviewerVerdict(
  cardId: string,
  verdict: "pass" | "fail",
  feedback: string
): void {
  reviewerEventBus.emit("verdict", cardId, verdict, feedback);
}
