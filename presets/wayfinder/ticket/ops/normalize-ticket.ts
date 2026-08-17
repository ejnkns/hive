// The ticket workflow's normalize_ticket operation, referenced by the wayfinder blueprint.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { readDependsOn, readString } from "../../shared/read.ts";
import type { TicketState } from "../types.ts";

const TICKET_TYPES = ["research", "prototype", "grilling", "task"] as const;

// Creates a ticket with a sharp shape regardless of how it was born: the Add
// ticket / Add fog entry forms collect loose strings (dependsOn as a
// comma-separated id list, a type the human may have typed loosely, fog entries
// with only a brief), while agent-created tickets via create_instance carry
// proper arrays. Normalizing once in fog lets the claim gates and the engine's
// dependsOnState backstop read a stable shape.
function normalizeTicketOp(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<TicketState>
): { ok: boolean; type: string; dependsOn: string[] } {
  const state = ctx.workflowInstanceState();
  const rawType = readString(state.type)?.toLowerCase().trim();
  // TICKET_TYPES.some narrows rawType to one of the four literals, so the cast
  // only ever narrows a string already proven to be a TicketType.
  const type: string =
    rawType !== undefined && TICKET_TYPES.some((t) => t === rawType)
      ? (rawType as string)
      : "grilling";
  const title =
    readString(state.title) ??
    readString(state.brief) ??
    readString(state.question) ??
    "Untitled ticket";
  const question =
    readString(state.question) ?? readString(state.brief) ?? title;
  const dependsOn = readDependsOn(state.dependsOn);
  // graduated (the charting agent's sharp-ticket marker) rides through so the
  // fog auto-transition can graduate it; the writer declaration keeps the
  // validator's read↔write invariant honest.
  const graduated = state.graduated === true;
  ctx.patchWorkflowInstanceState({
    title,
    question,
    type,
    dependsOn,
    graduated,
  });
  return { ok: true, type, dependsOn };
}

export const normalize_ticketOperations = defineOperations<TicketState>({
  normalize_ticket: normalizeTicketOp,
});
