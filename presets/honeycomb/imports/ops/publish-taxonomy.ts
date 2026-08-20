// The imports workflow's publish_taxonomy operation, referenced by the
// honeycomb flow definition. Merges the parse agent's derived categories into
// flowState's taxonomy (union by name) so earlier imports' categories survive
// and the edit form's category select keeps offering them. Written via a
// patchFlowState op — a toFlowState edge cannot: edges fire only on terminal
// states, and the taxonomy must be published before the import's fan-out
// creates the idea cards.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { Taxonomy, TaxonomyCategory } from "../../types.ts";
import type { ImportsState } from "../types.ts";

// The parse task's output: the completion-tool arguments become the task
// output, so the op reads output.categories.
type ParseOutput = {
  output?: { categories?: TaxonomyCategory[] };
};

export const publish_taxonomyOperations = defineOperations<ImportsState>({
  publish_taxonomy: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<ImportsState>
  ) => {
    const raw = ctx.taskOutputs().parse as ParseOutput | undefined;
    const fresh = raw?.output?.categories ?? [];
    const existing =
      (ctx.flowState().taxonomy as Taxonomy | undefined)?.categories ?? [];
    // Union by name: existing categories keep their position; fresh ones
    // append. Re-imports of the same category are no-ops.
    const seen = new Set(existing.map((c) => c?.name));
    const merged = [...existing];
    for (const c of fresh) {
      if (c?.name !== undefined && !seen.has(c.name)) {
        seen.add(c.name);
        merged.push(c);
      }
    }
    ctx.patchFlowState({
      taxonomy: {
        categories: merged,
        // The edit form's category select sources its options from flowState
        // (E4) — an array of strings, resolved by the server at serialization.
        categoryNames: merged
          .map((c) => c?.name)
          .filter((name): name is string => typeof name === "string"),
      },
    });
    return {
      ok: true,
      categories: merged.length,
      added: merged.length - existing.length,
    };
  },
});
