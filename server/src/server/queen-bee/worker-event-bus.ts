import { EventEmitter } from "node:events";
import type { WorkerEvent } from "./worker-supervisor";

export const workerEventBus = new EventEmitter<{
  event: [WorkerEvent, string];
}>();

export function emitWorkerEvent(event: WorkerEvent, projectId: string): void {
  workerEventBus.emit("event", event, projectId);
}
