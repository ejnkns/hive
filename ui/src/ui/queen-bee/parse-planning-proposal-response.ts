import type {
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { isPlanningProposal, isRequirementsFeedback } from "shared/board-types";
import { isRecord } from "../check-record";

export function parsePlanningProposalResponse(value: unknown): {
  proposal?: PlanningProposal;
  feedback?: RequirementsFeedback;
  error?: string;
} {
  if (!isRecord(value)) return {};
  return {
    ...(isPlanningProposal(value.proposal) ? { proposal: value.proposal } : {}),
    ...(isRequirementsFeedback(value.feedback)
      ? { feedback: value.feedback }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}
