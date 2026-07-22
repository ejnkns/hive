import type { PlanningOutcome } from "shared/board-types";

export function planningResponse(outcome: PlanningOutcome):
  | { kind: "proposal"; proposal: PlanningOutcome & { kind?: never } }
  | {
      kind: "feedback";
      feedback: PlanningOutcome & { kind: "requirements_feedback" };
    } {
  return "kind" in outcome
    ? { kind: "feedback" as const, feedback: outcome }
    : { kind: "proposal" as const, proposal: outcome };
}
