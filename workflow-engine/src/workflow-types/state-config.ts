/** @private — the workflow state configuration: StateDef, WorkflowConfig,
 * and the defineWorkflow builder. */

import type { TaskBase } from "../runners/task-types.ts";
import type {
  AutoTransition,
  BoardColumn,
  ManualAction,
  StateCategory,
  WorkflowView,
} from "./actions.ts";
import type { ConfigField } from "./config-field.ts";
import type { DisplayHint } from "./display.ts";
import type { RenderHint } from "./render-hints.ts";

// --- State definition ---

// Each task role tells the engine how to run it:
//   "ai-task"   — one-shot AI run with tools until it calls submit_work
//   "ai-chat"   — multi-turn interactive conversation between user and AI.
//     The user sends messages to the chat, the AI responds. AutoTransitions
//     are evaluated only after the AI signals completion.
//   "operation" — deterministic operations run synchronously.

// One task inside a StateDef. Mapped over TTaskOutputs so each task's `render`
// hint is typed against that specific task's output (id anchors the member).
// Built from TaskBase (runners/task-types.ts) — the single source of the task
// shape — so the authoring side and the runtime side can never drift; only the
// typed `id` and the authoring-only `render` hint are added here.
export type StateTaskDef<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  [K in keyof TTaskOutputs & string]: TaskBase & {
    id: K;
    // How the task's completed output renders in the generic UI. Pure data.
    render?: RenderHint<TTaskOutputs[K]>;
  };
}[keyof TTaskOutputs & string];

export type StateDef<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
  TItemState extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: TStateId;
  label: string;
  description?: string;
  category?: StateCategory;

  tasks?: StateTaskDef<TTaskOutputs>[];

  autoTransitions?: AutoTransition<TTaskOutputs, TStateId, TItemState>[];

  actions?: ManualAction<TTaskOutputs, TStateId, TItemState>[];
};

export type RuntimeStateDef = StateDef;

// --- Workflow configuration (the full runtime shape) ---

export type WorkflowConfig<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  id: string;
  label: string;
  description?: string;
  // The workflow-instance header hint: dotted paths into the instance's
  // workflowInstanceState for the title/subtitle. Pure data; never stored.
  instance?: { title: string; subtitle?: string };
  // The workflow-instance body hint: which workflowInstanceState fields to
  // show, each with an optional render hint. Pure data.
  display?: DisplayHint<TWorkflowInstanceState>;
  // A curated, user-editable subset of workflowInstanceState: when declared,
  // the generic UI renders an "Edit details" form on each instance of this
  // workflow (pre-filled from current state) and submits validated values
  // through the instance-state patch API. The collected values are validated
  // against these fields (collectConfigFieldValues) — unknown keys rejected,
  // required enforced — and written into workflowInstanceState in place (no
  // transition, no attempt bump). Fields the engine or agents write that are
  // not listed here stay untouched and uneditable in the UI.
  editFields?: ConfigField[];
  // Per-workflow rendering hooks. Pure data.
  ui?: {
    // Registry-resolved custom instance renderer; falls back to the default
    // WorkflowInstanceCard when unknown.
    instanceComponent?: string;
    // How the workflow's instances lay out in the generic surface; board (the
    // default) groups by state, list/document/chat render flat.
    view?: WorkflowView;
    // Optional board curation: ordered lanes folding states into columns.
    // Absent → the default derived board (one column per state).
    columns?: readonly BoardColumn[];
  };
  taskOutputs: TTaskOutputs;
  states: readonly StateDef<TTaskOutputs, TStateId, TWorkflowInstanceState>[];
  initial: TStateId;
  terminalStates: readonly TStateId[];
};

export type RuntimeWorkflowConfig = WorkflowConfig;

// --- Builder ---

export function defineWorkflow<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
>(
  config: WorkflowConfig<TTaskOutputs, TStateId, TWorkflowInstanceState> & {
    // Authoring-only generic anchor, erased from the returned
    // RuntimeWorkflowConfig.
    workflowInstanceState?: TWorkflowInstanceState;
  }
): RuntimeWorkflowConfig {
  // Gates/transforms are authored against specific generics (e.g.
  // GateContext<CardsTaskOutputs>) but invoked at runtime against the
  // erased RuntimeGateContext. Both share identical runtime shape — the
  // generics only affect compile-time key typing. Erasing here means the
  // engine never sees WorkflowConfig<any, any, any>.
  return config as RuntimeWorkflowConfig;
}
