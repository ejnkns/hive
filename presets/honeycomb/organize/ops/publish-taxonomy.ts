// The organize workflow's publish_taxonomy operation, referenced by the
// honeycomb flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OrganizeState } from "../types.ts";

// Publishes the approved taxonomy into flowState (E2) — the shared, declared
// cross-entity state every classifier reads. A toFlowState edge cannot do
// this: edges fire only on terminal states, and organize continues past
// approval — so the taxonomy is written via a patchFlowState op, mirroring
// the existing patchFlowConfig.
export const publish_taxonomyOperations = defineOperations<OrganizeState>({
  publish_taxonomy: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizeState>
  ) => {
    const state = ctx.workflowInstanceState();
    const categories = state.categories ?? [];
    ctx.patchFlowState({
      taxonomy: {
        categories,
        // The edit form's category select sources its options from flowState
        // (E4) — an array of strings, resolved by the server at serialization.
        categoryNames: categories
          .map((c) => c?.name)
          .filter((name): name is string => typeof name === "string"),
        priorityScale: state.priorityScale,
        effortScale: state.effortScale,
        dedupPolicy: state.dedupPolicy ?? "",
      },
    });
    return { ok: true, categories: categories.length };
  },
});
