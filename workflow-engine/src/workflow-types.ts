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
  effect?: () => void | Promise<void>;
};

export type RuntimeAutoTransition = AutoTransition;

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

export type RuntimeManualAction = ManualAction;

// --- State definition ---

// Each task role tells the engine how to run it:
//   "ai-task"   — one-shot AI run with tools until it calls submit_work
//   "ai-chat"   — multi-turn interactive conversation between user and AI.
//     The user sends messages to the chat, the AI responds. AutoTransitions
//     are evaluated only after the AI signals completion.
//   "operation" — deterministic operations run synchronously.

export type StateDef<
  TTaskOutputs extends Record<string, unknown> = Record<string, unknown>,
  TStateId extends string = string,
  TItemState extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: TStateId;
  label: string;
  description?: string;
  category?: StateCategory;

  tasks?: {
    id: keyof TTaskOutputs & string;
    label: string;
    trigger: "auto" | "manual";
    role: "ai-task" | "ai-chat" | "operation";
    tools?: ToolName[];
    operations?: string[];
    operationInputs?: Record<string, unknown>;
    systemPrompt?: string;
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
  }[];

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
  // UI-side rendering hint for derived views; never stored.
  item?: { title: string; subtitle?: string };
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
