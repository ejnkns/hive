/** @private — core engine types: task outcomes, running-task context,
 * model-call status, and the gate context. */

import type { ChatMessage } from "../shared/chat-message.ts";

export type { ChatMessage } from "../shared/chat-message.ts";

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

// The contract a definition-referenced gate implements: a predicate over the
// runtime gate context. The renderer emits stubs typed with this and the
// module-set lint checks the referenced export against it.
export type GateContract = (ctx: RuntimeGateContext) => boolean;
