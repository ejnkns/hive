// The organize workflow's apply_classifications operation, referenced by the
// honeycomb flow definition. This is the E1 cross-instance write: one global
// pass whose results land on existing idea cards (matched by title), never
// fanning out new instances — re-runs patch in place.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { IdeaClassification, OrganizeState } from "../types.ts";

// The classification output of the classifyAll task: the completion-tool
// arguments become the task output, so the op reads output.classifications.
type ClassifyAllOutput = {
  output?: { classifications?: IdeaClassification[] };
};

export const apply_classificationsOperations = defineOperations<OrganizeState>({
  apply_classifications: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizeState>
  ) => {
    const raw = ctx.taskOutputs().classifyAll as ClassifyAllOutput | undefined;
    const classifications = raw?.output?.classifications ?? [];
    const ideas = ctx.workflowInstancesInState("ideas");
    const byTitle = new Map(
      ideas.map((i) => [String(i.workflowInstanceState.title), i.id])
    );

    let applied = 0;
    let skipped = 0;
    for (const c of classifications) {
      const target = byTitle.get(c.title);
      if (target === undefined) {
        skipped++;
        continue;
      }
      // E1: patch the sibling idea's declared state. Only defined values are
      // written so a classification missing a field leaves the card's
      // previous value intact.
      const patch: Record<string, unknown> = {};
      if (c.category !== undefined) patch.category = c.category;
      if (c.tags !== undefined) patch.tags = c.tags;
      if (c.priority !== undefined) patch.priority = c.priority;
      if (c.effort !== undefined) patch.effort = c.effort;
      if (c.status !== undefined) patch.status = c.status;
      if (c.dependsOn !== undefined) patch.dependsOn = c.dependsOn;
      if (c.duplicateOf !== undefined) patch.duplicateOf = c.duplicateOf;
      if (c.summary !== undefined) patch.summary = c.summary;
      if (c.rationale !== undefined) patch.rationale = c.rationale;
      if (ctx.patchInstanceState(target, patch)) applied++;
    }

    // dependents are computed per instance: every idea whose dependsOn
    // names this idea's title. Recomputed on every pass so edits and
    // re-classifications stay current.
    for (const idea of ideas) {
      const title = String(idea.workflowInstanceState.title);
      const dependents = ideas
        .filter((other) => {
          const deps = other.workflowInstanceState.dependsOn;
          return Array.isArray(deps) && deps.includes(title);
        })
        .map((other) => String(other.workflowInstanceState.title));
      ctx.patchInstanceState(idea.id, { dependents });
    }

    return {
      ok: true,
      applied,
      skipped,
      cards: ideas.length,
      dependents: ideas.length,
    };
  },
});
