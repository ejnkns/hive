import type { SessionStage } from "shared/dashboard-types";

export { isTerminal } from "shared/dashboard-types";

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
