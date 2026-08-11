/** @private — action/state vocabulary: variants, visible actions, state
 * categories, views, board columns, transitions, and manual actions. */

import type { ConfigField } from "./config-field.ts";
import type { GateContext } from "./core.ts";

// --- Action variant ---

// Visual hint for UI rendering. An AI agent generating UI can style
// buttons based on variant: primary = call-to-action, secondary = neutral,
// destructive = irreversible change, default = fallback.
export type ActionVariant = "primary" | "secondary" | "destructive" | "default";

// --- Visible action returned to the UI ---

export type VisibleAction = {
  id: string;
  label: string;
  variant: ActionVariant;
  // Declared input fields: the UI renders a small form and dispatch carries
  // the collected values into the instance's workflowInstanceState.
  fields?: ConfigField[];
  // Custom wording for the two-click confirm step. Absent → the default
  // "Confirm <label>?" text. Declaring it implies the action requires a
  // confirm step regardless of variant (destructive always confirms).
  confirmText?: string;
};

// --- State category ---

// Semantic role of a state within the workflow lifecycle.
// "initial" — the first state the workflow starts in
// "active" — a state where work happens (tasks may run)
// "terminal" — a final state (no further transitions)
// "error" — a state representing failure/unfulfillable
export type StateCategory = "initial" | "active" | "terminal" | "error";

// How a workflow's instances lay out in the generic rendering surface. board
// groups instances into state columns (the default when unset); the others
// render as a flat stacked list. Pure data; the surface may fall back.
export type WorkflowView = "board" | "list" | "document" | "chat";

// One curated board column: a named lane a definition folds states into. Board
// rendering honors WorkflowConfig.ui.columns (when declared) instead of the
// default one-column-per-state derived board, so a definition renders its
// canonical columns (e.g. queen-bee's Ready / In Progress / Reviewing / Done /
// Unfulfillable) rather than every transient state. Pure data; board-only.
export type BoardColumn = {
  id: string;
  label: string;
  // State ids folded into this column, in display order. A state may appear in
  // at most one column; states no column lists fall into a trailing "Other"
  // column so no instance disappears from the board.
  states: readonly string[];
};

// --- Transitions ---

// AutoTransition: evaluated automatically when a state's tasks complete.
// The gate receives the partial output map — use optional chaining.
export type AutoTransition<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TToStateId extends string = string,
  TItemState extends Record<string, unknown> = Record<string, unknown>,
> = {
  to: TToStateId;
  gate: (ctx: GateContext<TTaskOutputs, TItemState>) => boolean;
};

// ManualAction: a button the user can click to trigger a state change.
// gate controls visibility; transitionTo is the target state.
// variant provides a visual hint for UI rendering.
export type ManualAction<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
  TItemState extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  label: string;
  variant?: ActionVariant;
  // Custom wording for the two-click confirm step (destructive actions confirm
  // by default with "Confirm <label>?"; declaring this implies a confirm step
  // for any variant, and overrides the wording). A destructive action that
  // also declares `fields` collects the payload first, then confirms — the
  // "confirm + reason" pattern.
  confirmText?: string;
  gate?: (ctx: GateContext<TTaskOutputs, TItemState>) => boolean;
  maxWorkflowInstancesInTarget?: number;
  dependsOnState?: TStateId;
  // Spawns a new workflow instance. fields render as a form; the collected
  // values become the new instance's workflowInstanceState.
  createInstance?: { workflowId: string; fields?: ConfigField[] };
  // Declared input fields collected from the user when this action is
  // dispatched: the values are validated against the fields and written into
  // the acting instance's workflowInstanceState before the transition (so a
  // correction note, reject reason, or due date travels with the action).
  fields?: ConfigField[];
  // When true, dispatching this action completes the running ai-chat task
  // instead of cancelling it: the live transcript becomes the task output,
  // recorded as success, then the state transitions to transitionTo. HITL
  // sessions (grilling, wayfinder decision tickets) end this way — the
  // conversation is the result. Ignored unless an ai-chat task is running.
  completesRunningTask?: boolean;
  // When true, dispatching this action starts a NEW attempt: the engine bumps
  // the instance's `attempt` counter (engine-provided state) and discards the
  // abandoned workspace recorded in `worktreePath`, so the next run builds a
  // fresh branch/worktree and persists under {attempt}-scoped paths. The old
  // attempt stays identifiable in history and its branch is left in place.
  // This is how a flow declares "restart from a clean slate" (queen-bee's
  // new_changes) without owning any attempt bookkeeping.
  newAttempt?: boolean;
  transitionTo: TStateId;
};
