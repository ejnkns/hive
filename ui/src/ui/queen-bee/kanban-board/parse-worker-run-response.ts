/** @private — only imported by kanban-board.svelte */

import { isWorkerAdmission, type WorkerAdmission } from "shared/board-types";
import { isRecord } from "../../check-record";

export type WorkerRunResponse = {
  admission?: WorkerAdmission;
  error?: string;
};

export function parseWorkerRunResponse(value: unknown): WorkerRunResponse {
  if (!isRecord(value)) return {};
  return {
    ...(isWorkerAdmission(value.admission)
      ? { admission: value.admission }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}
