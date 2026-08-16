// The ideas workflow's check_classification operation, referenced by the
// honeycomb flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { IdeaState } from "../types.ts";

// A deterministic beat: completing this task lets the imported state's
// auto-transitions evaluate. The needs_classify gate routes a card to the
// per-idea classify state only when it lacks a category AND the approved
// taxonomy exists — so fan-out cards (classified by the global pass) stay
// put, and manually added cards classify themselves against the taxonomy.
export const check_classificationOperations = defineOperations<IdeaState>({
  check_classification: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<IdeaState>
  ) => {
    const state = ctx.workflowInstanceState();
    return { ok: true, category: state.category ?? null };
  },
});
