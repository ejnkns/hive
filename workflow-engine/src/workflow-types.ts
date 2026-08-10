// === WORKFLOW TYPES (CORE) ===
//
// A workflow is a declarative state machine. States have tasks (work
// done by agents or deterministic callers) and actions (buttons the
// user can click). Transitions between states are computed from task
// outcomes and runtime conditions.
//
// The types are generic — no domain-specific concepts. Any project
// lifecycle can be expressed. Domain concepts arrive only through the
// generic parameters and through the self-contained tools a FlowDefinition
// declares; the engine never interprets a tool's meaning.
//
// == Generic-erasure convention ==
//
// The generic parameters provide type safety at definition site (the
// workflow author's taskOutputs / item state shapes). At runtime the
// engine stores heterogeneous workflows (cards, requirements, ideas) in
// one collection, so the generics are erased to their defaults. The
// "Runtime*" aliases below are exactly those erased instantiations.
// defineWorkflow is the single boundary where the erasure happens.

import type { OperationFn } from "./runners/create-operation-runner";
import type { TaskBase } from "./runners/task-types";
import type { Tool } from "./runners/tool-types";
import type { ChatMessage } from "./shared/chat-message";

// Re-exported so existing consumers (engine-bridge, presets) can keep
// importing the message shape from the schema module.
export type { ChatMessage } from "./shared/chat-message";

// --- Convenience aliases ---

export type NoOutput = Record<string, never>;

// --- Task outcomes ---

export type TaskOutcome<TOutput> = {
  status: "success" | "error";
  output: TOutput;
  error?: string;
};

// Maps each declared task id to its typed outcome.
// Gate functions receive Partial<> because not all tasks have run yet —
// the engine only populates outputs for completed tasks.
export type TaskOutputMap<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  [K in keyof TTaskOutputs]: TaskOutcome<TTaskOutputs[K]>;
};

// --- Running task context ---

// Per-role runtime state exposed to the UI and gate functions while a
// task is actively executing.
// Live progress of the current model call backing an agent task: routing
// (before a node is chosen) → dispatched (the node the request went to) →
// thinking (reasoning tokens) → streaming (output tokens) → complete. Surfaced
// in the running task context so the chat UI can show what the agent is doing.
export type ModelCallStatus =
  | { stage: "routing" }
  | { stage: "dispatched"; provider: string; model: string }
  | { stage: "thinking" }
  | { stage: "streaming" }
  | { stage: "complete" }
  | { stage: "error"; message: string };

export type RunningTaskContext =
  | {
      role: "ai-task";
      messages: ChatMessage[];
      modelStatus?: ModelCallStatus;
    }
  | {
      role: "ai-chat";
      messages: ChatMessage[];
      sessionId: string;
      // Whether the session accepts user messages: true only for tasks
      // declared startOnUserInput (HITL sessions). One-shot agents (e.g. the
      // cards worker) are read-only — the UI hides the input row.
      interactive: boolean;
      modelStatus?: ModelCallStatus;
    }
  | {
      role: "operation";
    };

// --- Gate context ---

// Context evaluated for every gate function.
// taskOutputs is Partial: only completed tasks have entries.
// hasRunningTask is true when an agent or session task is actively executing.
// runningTaskContext contains the active task's runtime data (null when idle).
// itemState carries per-item domain data (e.g. card-specific state).
export type GateContext<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
  TFlowState extends Record<string, unknown> = Record<string, unknown>,
> = {
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskContext: RunningTaskContext | null;
  workflowInstanceState: TWorkflowInstanceState;
  flowState: TFlowState;
  // Consecutive error counts per task id (see WorkflowInstanceState). Gates
  // use this to bound retry loops: a task that keeps failing escalates instead
  // of looping forever, without per-preset bookkeeping.
  taskErrorCounts: Readonly<Record<string, number>>;
  workflowInstancesInState?: (stateId?: string) => {
    currentState: string;
    id: string;
    workflowInstanceState: Record<string, unknown>;
  }[];
};

export type RuntimeGateContext = GateContext;

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

// --- Render hints ---
//
// A small optional vocabulary a workflow definition uses to self-describe how
// its data renders in the generic flow UI. Hints are pure data — JSON
// serializable, never functions — so they cross the server wire unchanged. The
// rendering surface resolves each hint against a kind's input contract and
// falls back to raw rendering when a hint is absent or its contract mismatches.
//
// `kind` is a type-shape discriminator (what shape the component consumes), not
// a presentation pick. Built-in kinds ship with the engine; a flow definition
// may declare custom kinds and their input contracts (FlowDefinition.ui.kinds).
// The `kind` field stays open so custom kinds can register later without a
// schema change.

export type BuiltinRenderKind = "markdown" | "text" | "card" | "cards" | "json";
export type RenderKind = BuiltinRenderKind | (string & {});

// The value types a render contract's props may declare. The runtime validates
// resolved prop values against these; "unknown" accepts anything.
export type RenderPropType =
  | "string"
  | "string[]"
  | "array"
  | "boolean"
  | "number"
  | "unknown";

// Where a contract prop resolves its value from.
//   output:  against the task output / display field value
//   element: against each item of the kind's array input (the output-scoped
//            prop declared with type "array")
export type RenderPropScope = "output" | "element";

export type RenderContractProp = {
  name: string;
  type: RenderPropType;
  scope: RenderPropScope;
};

export type RenderContract = {
  props: readonly RenderContractProp[];
};

// The built-in kind contracts, shipped to the UI for runtime validation. A
// custom kind declares the same shape in the flow definition
// (FlowDefinition.ui.kinds).
export const builtinRenderContracts = {
  markdown: {
    props: [{ name: "content", type: "string", scope: "output" }],
  },
  text: {
    props: [{ name: "content", type: "string", scope: "output" }],
  },
  card: {
    props: [
      { name: "title", type: "string", scope: "output" },
      { name: "description", type: "string", scope: "output" },
      { name: "bullets", type: "string[]", scope: "output" },
    ],
  },
  cards: {
    props: [
      { name: "items", type: "array", scope: "output" },
      { name: "title", type: "string", scope: "element" },
      { name: "description", type: "string", scope: "element" },
      { name: "bullets", type: "string[]", scope: "element" },
    ],
  },
  json: { props: [] },
} as const satisfies Record<BuiltinRenderKind, RenderContract>;

// A dotted path into TOutput ("cardSpec.title"). The empty string resolves to
// the root. For a union output every member's paths are allowed (distributive),
// so a discriminated-union output (e.g. a plan proposal) accepts paths that
// exist on any member. Array and non-object outputs accept any path string —
// their element shapes are unknown to the hint's static type.
export type PropPath<TOutput> = TOutput extends object
  ? TOutput extends readonly unknown[]
    ? string
    : {
        [K in keyof TOutput & string]: K | `${K}.${PropPath<TOutput[K]>}`;
      }[keyof TOutput & string]
  : string;

// The serialized (runtime) render hint shape: kind open to any string, props a
// plain path map. This is the wire form and the erasure RenderHint compiles to.
export type RuntimeRenderHint = {
  kind: RenderKind;
  props?: Record<string, string>;
};

type ContractForKind<K extends BuiltinRenderKind> =
  (typeof builtinRenderContracts)[K];
type OutputPropNames<C extends RenderContract> = Extract<
  C["props"][number],
  { scope: "output" }
>["name"];
type ElementPropNames<C extends RenderContract> = Extract<
  C["props"][number],
  { scope: "element" }
>["name"];

// The compile-time checked hint for a built-in kind: props keys must be the
// kind's contract prop names; output-scoped prop values must be paths into the
// task output. Element-scoped prop values are left as strings — their
// resolution base (the items array element) depends on another prop's value,
// which TypeScript cannot express, so the runtime validates them.
export type BuiltinRenderHint<TOutput> = {
  [K in BuiltinRenderKind]: K extends "json"
    ? { kind: K; props?: Record<string, never> }
    : {
        kind: K;
        props?: {
          [P in OutputPropNames<ContractForKind<K>>]?: PropPath<TOutput>;
        } & {
          [P in ElementPropNames<ContractForKind<K>>]?: string;
        };
      };
}[BuiltinRenderKind];

// A render hint, authored against the task's output type. Built-in kinds are
// checked against their contract (Level B). Custom kinds are intentionally not
// writable through this default: the schema anticipates them (open kind
// strings, serialized contracts, runtime validation with json fallback), and
// widening TCustomRenderKinds to a definition's custom kind set is the
// boundary future work (serving custom components) will cross.
export type RenderHint<
  TOutput = unknown,
  TCustomRenderKinds extends string = never,
> =
  | BuiltinRenderHint<TOutput>
  | { kind: TCustomRenderKinds; props?: Record<string, PropPath<TOutput>> };

// A flow-declared custom render kind: a name and the input contract the
// rendering surface validates resolved props against at runtime.
export type CustomRenderKind = {
  kind: string;
  contract: RenderContract;
};

// A derived display: compute a value from the resolved field value instead of
// showing it raw. Structured (no expression language) and evaluated by a
// shared pure helper (derive-display.ts) that engine and UI both use, so the
// rendering is deterministic. `where.field` addresses an item property of the
// resolved array; `equals` compares with strict equality.
export type DerivedDisplay =
  // Array length, optionally counting only items whose declared field equals
  // a value ("N pending").
  | {
      kind: "count";
      where?: { field: string; equals: string | number | boolean };
    }
  // "N of M": matching items over the array length ("3 of 5 done").
  | {
      kind: "progress";
      where: { field: string; equals: string | number | boolean };
    }
  // Running total over an array of numbers, or over a numeric item field.
  | { kind: "sum"; field?: string };

// The instance-state body hint: which workflowInstanceState fields the
// instance card shows. Each field's render props resolve against that field's
// value. Without a display hint the raw state dump is shown.
export type DisplayField<
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  path: PropPath<TWorkflowInstanceState>;
  label?: string;
  render?: RuntimeRenderHint;
  // When present, the resolved path value is run through the derived display
  // (count/progress/sum) before rendering. A derive that cannot evaluate
  // (non-array source, missing item field) falls back to the raw value.
  derive?: DerivedDisplay;
};

export type DisplayHint<
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  fields: readonly DisplayField<TWorkflowInstanceState>[];
};

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

// === FLOW DEFINITION ===

// Edge between workflows. The transform receives the source workflow's
// task outputs and produces context for the target workflow. It returns either
// one instance-state object or an array of them — an array creates one target
// workflow instance per element (fan-out, e.g. one cards instance per planned
// card). The returned object is checked against the target workflow's state
// type (TTargetState) so misspellings and undeclared fields fail to compile.
// When toFlowState is true, the transformed output updates FlowState instead
// of creating new instances. Omit or set toWorkflow for instance creation.
export type FlowEdge<
  TSourceOutputs extends Record<string, unknown> = Record<string, unknown>,
  TTargetState extends Record<string, unknown> = Record<string, unknown>,
> = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow?: string;
  toFlowState?: boolean;
  transform?: (
    source: Partial<TaskOutputMap<TSourceOutputs>>
  ) => Partial<TTargetState> | Partial<TTargetState>[];
};

export type RuntimeFlowEdge = FlowEdge;

// The value/input type of a ConfigField. `type` drives both validation and
// rendering (the existing code conflates value type with presentation — e.g.
// "string" + options renders a single select). Canonical stored formats:
//   "date"     → "YYYY-MM-DD" (what <input type="date"> emits)
//   "datetime" → "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> emits)
//   "string[]" → array of strings; with `options` a multi-select (every chosen
//                 value must be in `options`), without a free-form tag list
// The canonical formats are validated server-side (collectConfigFieldValues)
// and by the UI renderers, so stored values never drift.
export type ConfigFieldType =
  | "string"
  | "boolean"
  | "number"
  | "textarea"
  | "date"
  | "datetime"
  | "string[]";

// A field a definition's instances take as input at instantiation time.
// Declared by the definition (configSchema) and rendered by the UI as a form;
// the server validates instance config against it (required fields, types,
// unknown-field rejection).
export type ConfigField = {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  hint?: string;
  // Placeholder text inside the input. Unlike `hint` (helper text under the
  // field), this fills the control's empty state.
  placeholder?: string;
  // Pre-fill value. Rendered as the control's initial value when the form
  // opens (createInstance forms, and the gap-2 instance-edit form which passes
  // the current instance state through this prop).
  defaultValue?: string | boolean | number | string[];
  // For string fields: a closed set of allowed values. The server still
  // validates the value as a string; the UI renders a select instead of a free
  // text input. Optional and additive — absent means free text. For "string[]"
  // fields: the closed set a multi-select may choose from; absent means a free
  // tag list.
  options?: string[];
};

// A project-level action rendered on the flow instance header. Unlike a
// ManualAction (which lives on a workflow state), a flow-level action is
// declared on the FlowDefinition and may create a new workflow instance or
// dispatch a state-level action to every eligible instance of a workflow.
export type FlowLevelAction = {
  id: string;
  label: string;
  variant?: ActionVariant;
  gate?: (ctx: RuntimeGateContext) => boolean;
  // Creates a new instance of the workflow; fields render as a form and the
  // collected values become the new instance's workflowInstanceState.
  createInstance?: { workflowId: string; fields?: ConfigField[] };
  // Dispatches the referenced state-level action to every instance of the
  // workflow where that action is available (per-instance gates respected).
  dispatchToAll?: { workflowId: string; actionId: string };
};

// A FlowDefinition is the complete description of one flow type: its
// workflows, the edges between them, and the capabilities its tasks call by
// name — self-contained domain tools (schema + executor) and deterministic
// domain operations. Infrastructure tools and operations are not listed here —
// the engine ships them to every flow. Capabilities are resolved by name
// against the merged registry (engine infrastructure + this list) at runtime.
//
// A definition is either static (its workflows listed directly) or a factory
// (buildWorkflows resolves flow config into workflow configs). Static
// definitions ARE the layout; a factory exists for presets whose workflow
// definitions depend on flow config (e.g. a concurrency limit or a system
// prompt override). The engine executes the resolved result either way.
export type FlowDefinition = {
  id: string;
  label: string;
  description?: string;
  configSchema?: ConfigField[];
  edges: FlowEdge[];
  tools?: readonly Tool[];
  operations?: Record<string, OperationFn>;
  // Directory under basePath that holds this instance's persisted domain
  // state; defaults to .<definition-id>.
  domainDir?: string;
  // Project-level actions rendered on the instance header.
  actions?: FlowLevelAction[];
  // Flow-level rendering declarations. Pure data.
  ui?: {
    // Custom render kinds the definition's tasks may reference; the rendering
    // surface validates resolved props against each contract and falls back to
    // json on mismatch.
    kinds?: CustomRenderKind[];
    // Served-at-runtime component modules: component id → TypeScript module
    // source (erasable syntax). Each module default-exports a factory that
    // receives the app's lit runtime and returns the component/kinds it
    // registers. Opaque to the engine — the server transpiles and serves it;
    // the rendering surface fetches, evaluates, and registers the result.
    components?: Record<string, string>;
  };
} & (
  | { workflows: RuntimeWorkflowConfig[] }
  | {
      buildWorkflows: (
        config: Record<string, unknown>
      ) => RuntimeWorkflowConfig[];
    }
);

// --- History entries ---

export type TaskExecutionEntry<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: "task_execution";
  taskId: keyof TTaskOutputs & string;
  attempt: number;
  status: "running" | "success" | "error" | "cancelled";
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  context?: RunningTaskContext | null;
  metadata?: Record<string, unknown>;
};

export type StateTransitionEntry<TStateId extends string = string> = {
  type: "state_transition";
  fromState: TStateId;
  toState: TStateId;
  timestamp: string;
  actionId?: string;
};

export type WorkflowHistoryEntry<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
> = TaskExecutionEntry<TTaskOutputs> | StateTransitionEntry<TStateId>;
