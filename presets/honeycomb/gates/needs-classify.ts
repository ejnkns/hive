// honeycomb gate: a freshly created idea should run per-idea classification
// only when it is not yet categorized AND the approved taxonomy exists — fan-
// out cards wait for the global classify pass (which classifies everything),
// while manual additions classify themselves against the taxonomy.

import type { GateContract } from "workflow-engine/workflow-types";
import type { IdeaState } from "../ideas/types.ts";
import type { FlowState } from "../types.ts";

export const needsClassify: GateContract<IdeaState, FlowState> = (ctx) => {
  // category and taxonomy are optional until their writers run: the `??`/`?.`
  // guards are runtime truth (this gate exists to detect the unclassified
  // pre-taxonomy state), not type noise.
  const hasCategory = (ctx.workflowInstanceState.category ?? "").trim() !== "";
  const taxonomyReady = (ctx.flowState.taxonomy?.categories?.length ?? 0) > 0;
  return !hasCategory && taxonomyReady;
};
