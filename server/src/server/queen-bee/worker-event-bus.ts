import { EventEmitter } from "node:events";
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
