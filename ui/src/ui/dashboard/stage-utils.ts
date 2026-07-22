import type { SessionStage } from "shared/dashboard-types";

export function isTerminal(stage: SessionStage): boolean {
  return stage === "complete" || stage === "failed";
}

export const STAGE_LABELS: Record<SessionStage, string> = {
  received: "rec",
  selection: "sel",
  dispatched: "dis",
  thinking: "thk",
  streaming: "str",
  tool_use: "too",
  complete: "com",
  failed: "err",
};
