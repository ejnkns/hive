// === WORKFLOW TYPES (CORE) ===
//
// A workflow is a declarative state machine. States have tasks (work
// done by agents or deterministic callers) and actions (buttons the
// user can click). Transitions between states are computed from task
// outcomes and runtime conditions.
//
// The types are generic — no domain-specific concepts. Any project
// lifecycle can be expressed.

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
export type TaskOutputMap<TTaskOutputs extends Record<string, unknown>> = {
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
};

// --- Gate context ---

// Context evaluated for every gate function.
// taskOutputs is Partial: only completed tasks have entries.
// hasRunningTask is true when an agent or session task is actively executing.
// runningTaskContext contains the active task's runtime data (null when idle).
// itemState carries per-item domain data (e.g. card-specific state).
export type GateContext<
  TTaskOutputs extends Record<string, unknown>,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    never
  >,
  TFlowState extends Record<string, unknown> = Record<string, never>,
> = {
  taskOutputs: Partial<TaskOutputMap<TTaskOutputs>>;
  hasRunningTask: boolean;
  runningTaskContext: RunningTaskContext | null;
  workflowInstanceState: TWorkflowInstanceState;
  flowState: TFlowState;
  workflowInstancesInState?: (stateId?: string) => { currentState: string }[];
};

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
  TTaskOutputs extends Record<string, unknown>,
  TToStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  to: TToStateId;
  gate: (ctx: GateContext<TTaskOutputs, TItemState>) => boolean;
  effect?: () => void | Promise<void>;
};

// ManualAction: a button the user can click to trigger a state change.
// gate controls visibility; transitionTo is the target state.
// variant provides a visual hint for UI rendering.
export type ManualAction<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TItemState extends Record<string, unknown> = Record<string, never>,
> = {
  id: string;
  label: string;
  variant?: ActionVariant;
  gate?: (ctx: GateContext<TTaskOutputs, TItemState>) => boolean;
  transitionTo: TStateId;
};

// --- State definition ---

// Each task role tells the engine how to run it:
//   "ai-task"   — one-shot AI run with tools until it calls submit_work
//   "ai-chat"   — multi-turn interactive conversation between user and AI.
//     The user sends messages to the chat, the AI responds. AutoTransitions
//     are evaluated only after the AI signals completion.
//   "operation" — deterministic operations run synchronously.

export type StateDef<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string = string,
  TItemState extends Record<string, unknown> = Record<string, never>,
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
    tools?: string[];
    operations?: string[];
    systemPrompt?: string;
    completionTool?: string;
  }[];

  autoTransitions?: AutoTransition<TTaskOutputs, TStateId, TItemState>[];

  actions?: ManualAction<TTaskOutputs, TStateId, TItemState>[];
};

// --- Builder ---

export function defineWorkflow<
  TTaskOutputs extends Record<string, unknown>,
  TStateId extends string,
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    never
  >,
>(config: {
  id: string;
  label: string;
  description?: string;
  taskOutputs: TTaskOutputs;
  workflowInstanceState?: TWorkflowInstanceState;
  states: readonly StateDef<TTaskOutputs, TStateId, TWorkflowInstanceState>[];
  initial: TStateId;
  terminalStates: readonly TStateId[];
}) {
  return config;
}

// Structural type for a workflow after definition — used in FlowDefinition.
export type WorkflowDef = {
  id: string;
  label: string;
  description?: string;
  taskOutputs: Record<string, unknown>;
  states: readonly { id: string }[];
  initial: string;
  terminalStates: readonly string[];
};

// === FLOW DEFINITION ===

// Edge between workflows. The transform receives the source workflow's
// task outputs and produces context for the target workflow.
export type FlowEdge<
  TSourceOutputs extends Record<string, unknown> = Record<string, unknown>,
> = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow: string;
  transform?: (
    source: Partial<TaskOutputMap<TSourceOutputs>>
  ) => Record<string, unknown>;
};

export type FlowDefinition = {
  id: string;
  label: string;
  description?: string;
  workflows: WorkflowDef[];
  edges: FlowEdge[];
};

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
