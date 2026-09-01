/** The engine's dependency-satisfaction seam: the dependsOnState evaluation
 * shared by the action filter (get-available-actions) and the per-entry
 * projection the flow snapshot ships (getWorkflowInstanceEntries). One
 * implementation, one source of truth — surfaces consume the engine's own
 * evaluation instead of re-deriving "is this blocker satisfied" themselves.
 */

import { resolveDottedPath } from "./runners/resolve-dotted-path.ts";
import type {
  WorkflowInstanceProjection,
  WorkflowInstancesInState,
} from "./task-runner.ts";
import type { RuntimeStateDef } from "./workflow-types.ts";

// The per-entry dependency fact on a WorkflowInstanceEntry snapshot entry:
// the recorded dependsOn references and which of them the engine has NOT
// resolved. Presentation surfaces (cards, maps) map this fact to their own
// vocabulary; they never re-derive the satisfying state.
export type WorkflowDependencyProjection = {
  // The WorkflowItem's recorded `dependsOn` references, deduplicated, as
  // declared — instance ids or unresolved names.
  blockers: string[];
  // Recorded references the engine has not resolved. For every action of the
  // current state that declares `dependsOnState`, the references unmet for
  // that action's target state. Actions may disagree on the satisfying
  // state; the projection is existential — a reference is unsatisfied only
  // when NO declared action's requirement resolves it, mirroring what the
  // engine would actually allow (the entry can act when some declared
  // action's dependencies are met). A dangling reference (no matching
  // instance id, no matching instance title in any target state) is always
  // unsatisfied. Empty when the state declares no `dependsOnState` actions —
  // the engine imposes no dependency requirement there.
  unsatisfied: string[];
};

// Evaluate the recorded dependsOn references against the current state's
// declared dependsOnState targets. See WorkflowDependencyProjection for the
// resolution semantics.
export function projectDependencySatisfaction(options: {
  states: readonly RuntimeStateDef[];
  currentState: string;
  workflowInstanceState: Record<string, unknown>;
  workflowInstancesInState: WorkflowInstancesInState;
  instanceTitlePath?: string;
}): WorkflowDependencyProjection {
  const blockers = [...new Set(readDependsOn(options.workflowInstanceState))];
  if (blockers.length === 0) return { blockers, unsatisfied: [] };

  const stateDef = options.states.find(
    (state) => state.id === options.currentState
  );
  const declaringActions = (stateDef?.actions ?? []).filter(
    (action) => action.dependsOnState !== undefined
  );
  if (declaringActions.length === 0) return { blockers, unsatisfied: [] };

  const unsatisfied = new Set(blockers);
  for (const action of declaringActions) {
    const inState = options.workflowInstancesInState(
      undefined,
      action.dependsOnState
    );
    const unmet = unmetDependees(blockers, inState, options.instanceTitlePath);
    // Anything this action's target state resolves is satisfied for the
    // entry — some declared action can act on it.
    for (const reference of blockers) {
      if (!unmet.includes(reference)) unsatisfied.delete(reference);
    }
  }
  return { blockers, unsatisfied: [...unsatisfied] };
}

// The dependsOnState gate: every dependee must already be in the target state.
// Entries are instance IDs after name-resolution — but resolution runs only on
// edge fan-out, so rehydrated or directly-created instances may carry the
// dependency's name instead. A name entry matches the title (the workflow's
// instance.title hint) of any instance already in the target state, so a card
// becomes runnable as soon as its named dependency lands, regardless of how
// the dependency was recorded.
export function dependsOnMet(
  dependees: readonly string[],
  inState: readonly WorkflowInstanceProjection[],
  titlePath: string | undefined
): boolean {
  return unmetDependees(dependees, inState, titlePath).length === 0;
}

// The references among `dependees` not resolved to `inState` — either by
// instance id or (when a title path is known) by instance title.
function unmetDependees(
  dependees: readonly string[],
  inState: readonly WorkflowInstanceProjection[],
  titlePath: string | undefined
): string[] {
  if (dependees.length === 0) return [];
  const idSet = new Set(inState.map((instance) => instance.id));
  return dependees.filter((dependee) => {
    if (idSet.has(dependee)) return false;
    if (titlePath === undefined) return true;
    return !inState.some((instance) => {
      const title = resolveDottedPath(
        instance.workflowInstanceState,
        titlePath
      );
      return typeof title === "string" && title === dependee;
    });
  });
}

// dependsOn is written into workflowInstanceState by the flow edges /
// callers as a string[]; it is not part of the domain type contract.
export function readDependsOn(itemState: Record<string, unknown>): string[] {
  const raw = itemState.dependsOn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
