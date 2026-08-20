// honeycomb gate: an uncategorized idea card should run per-idea
// classification. Imported cards are classified by the parse agent as they
// fan out; this catches the cards that agent missed and any manually added
// card, classifying each with the published taxonomy when one exists and
// sensible defaults otherwise (the classify prompt handles both).

import type { GateContract } from "workflow-engine/workflow-types";
import type { IdeaState } from "../ideas/types.ts";
import type { FlowState } from "../types.ts";

export const needsClassify: GateContract<IdeaState, FlowState> = (ctx) => {
  // category is optional until a writer runs: the `??` guard is runtime
  // truth, not type noise.
  const hasCategory = (ctx.workflowInstanceState.category ?? "").trim() !== "";
  return !hasCategory;
};
