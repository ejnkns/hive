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
import type { Tool, ToolName } from "./runners/tool-types";

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
export type RunningTaskContext =
  | {
      role: "ai-task";
      messages: ChatMessage[];
    }
  | {
      role: "ai-chat";
      messages: ChatMessage[];
      sessionId: string;
    }
  | {
      role: "operation";
    };

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  // OpenAI-compatible tool call state: assistant messages carry the tool_calls
  // they issued, and the matching tool messages reference them by id. Required
  // for providers to accept a conversation that used tools.
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
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
  workflowInstancesInState?: (
    stateId?: string
  ) => { currentState: string; id: string }[];
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
  gate?: (ctx: GateContext<TTaskOutputs, TItemState>) => boolean;
  maxWorkflowInstancesInTarget?: number;
  dependsOnState?: TStateId;
  // Spawns a new workflow instance. fields render as a form; the collected
  // values become the new instance's workflowInstanceState.
  createInstance?: { workflowId: string; fields?: ConfigField[] };
  // When true, dispatching this action completes the running ai-chat task
  // instead of cancelling it: the live transcript becomes the task output,
  // recorded as success, then the state transitions to transitionTo. HITL
  // sessions (grilling, wayfinder decision tickets) end this way — the
  // conversation is the result. Ignored unless an ai-chat task is running.
  completesRunningTask?: boolean;
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
export type StateTaskDef<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  [K in keyof TTaskOutputs & string]: {
    id: K;
    label: string;
    trigger: "auto" | "manual";
    role: "ai-task" | "ai-chat" | "operation";
    tools?: ToolName[];
    operations?: string[];
    operationInputs?: Record<string, unknown>;
    systemPrompt?: string;
    // The completion contract (how a task ends and what becomes its output):
    //   completionTool   — the agent calls this tool to end the task; the
    //                      parsed tool arguments become the task output.
    //                      Available to ai-task and ai-chat.
    //   completionSignal — the ai-chat agent ends the session by writing this
    //                      marker as the last line of its response; the
    //                      transcript becomes the task output. ai-chat only;
    //                      ignored by ai-task (which ends via completionTool).
    //   completesRunningTask (ManualAction) — the HUMAN ends a running ai-chat
    //                      session via a "Done" action; the transcript becomes
    //                      the task output.
    completionTool?: string;
    completionSignal?: string;
    startOnUserInput?: boolean;
    // A dotted path into the instance's workflowInstanceState resolved at task
    // start and injected as the first user message (e.g. the requirements
    // document for the planner). Mirrors TaskDefinition.inputFromInstanceState.
    inputFromInstanceState?: string;
    // A literal workspace directory or an "@instance:<field>" ref into the
    // workflow instance state (e.g. "@instance:worktreePath") that the ai
    // runners resolve before building the tool context.
    workspacePath?: string;
    // Written on successful completion to basePath/<domainDir>/<path>.
    // {instanceId} and {attempt} in path are substituted per workflow
    // instance. Format is inferred from the output: string becomes a text
    // file, object/array becomes JSON.
    persist?: { path: string };
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
  // Per-workflow rendering hooks. Pure data.
  ui?: {
    // Registry-resolved custom instance renderer; falls back to the default
    // WorkflowInstanceCard when unknown.
    instanceComponent?: string;
    // How the workflow's instances lay out in the generic surface; board (the
    // default) groups by state, list/document/chat render flat.
    view?: WorkflowView;
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
// card). When toFlowState is true, the transformed output updates FlowState
// instead of creating new instances. Omit or set toWorkflow for instance creation.
export type FlowEdge<
  TSourceOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow?: string;
  toFlowState?: boolean;
  transform?: (
    source: Partial<TaskOutputMap<TSourceOutputs>>
  ) => Record<string, unknown> | Record<string, unknown>[];
};

export type RuntimeFlowEdge = FlowEdge;

// A field a definition's instances take as input at instantiation time.
// Declared by the definition (configSchema) and rendered by the UI as a form;
// the server validates instance config against it (required fields, types,
// unknown-field rejection).
export type ConfigField = {
  key: string;
  label: string;
  type: "string" | "boolean" | "number";
  required?: boolean;
  hint?: string;
  // For string fields: a closed set of allowed values. The server still
  // validates the value as a string; the UI renders a select instead of a free
  // text input. Optional and additive — absent means free text.
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
