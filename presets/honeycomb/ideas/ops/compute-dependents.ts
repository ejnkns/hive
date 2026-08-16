// The ideas workflow's compute_dependents operation, referenced by the
// honeycomb flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { IdeaState } from "../types.ts";

// Recomputes this idea's dependents after a per-idea classification: every
// idea whose dependsOn names this idea's title. (The global apply pass
// recomputes dependents for all cards; this covers manually classified ones.)
export const compute_dependentsOperations = defineOperations<IdeaState>({
  compute_dependents: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<IdeaState>
  ) => {
    const state = ctx.workflowInstanceState();
    const title = typeof state.title === "string" ? state.title : "";
    const ideas = ctx.workflowInstancesInState("ideas");
    const dependents = ideas
      .filter((other) => {
        const deps = other.workflowInstanceState.dependsOn;
        return Array.isArray(deps) && deps.includes(title);
      })
      .map((other) => String(other.workflowInstanceState.title));
    ctx.patchWorkflowInstanceState({ dependents });
    return { ok: true, dependents };
  },
});
