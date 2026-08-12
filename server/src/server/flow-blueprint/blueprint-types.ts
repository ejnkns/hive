/** @private — the FlowBlueprint type vocabulary, shared by the blueprint validators. */

import type {
  BoardColumn,
  ConfigField,
  DerivedDisplay,
  RuntimeRenderHint,
  WorkflowView,
} from "workflow-engine/workflow-types";

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "boolean[]"
  | "object"
  | "object[]";

export type InstanceStateField = { field: string; type: FieldType };

// A structured completion contract on an ai-task/ai-chat: the renderer
// generates a completion tool with exactly these fields (all required); the
// agent calls it to end the task; the parsed arguments become the task output
// (so patch ops read output.<field> and gates compare output.<field>).
export type CompletionOutputField = {
  field: string;
  type: FieldType;
  description?: string;
};

// Where a write's value comes from. `taskOutput` paths are dot-paths relative
// to the referenced task's outcome (e.g. "output", "output.completion.verdict").
export type ValueSpec =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "taskOutput"; task: string; path: string }
  | { kind: "instanceId" };

// Fan-out item value sources (the array element is the base).
export type FanOutValueSpec =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "itemPath"; path: string }
  | { kind: "instanceId" };

export type GateSpec =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "hasRunningTask" }
  | { kind: "noRunningTask" }
  | { kind: "taskSuccess"; task: string }
  | { kind: "taskError"; task: string }
  // path is a dot-path relative to the task's outcome
  | {
      kind: "taskOutputEquals";
      task: string;
      path: string;
      value: string | number | boolean;
    }
  | {
      kind: "instanceStateEquals";
      field: string;
      value: string | number | boolean;
    }
  | { kind: "errorCountAtLeast"; task: string; count: number }
  | { kind: "not"; gate: GateSpec }
  | { kind: "and"; gates: GateSpec[] }
  | { kind: "or"; gates: GateSpec[] };

export type TaskSpec = {
  id: string;
  label?: string;
  role: "operation" | "ai-task" | "ai-chat";
  operations?: string[];
  operationInputs?: Record<string, unknown>;
  tools?: string[];
  completionTool?: string;
  completionSignal?: string;
  systemPrompt?: string;
  startOnUserInput?: boolean;
  workspacePath?: string;
  inputFromInstanceState?: string;
  persist?: { path: string };
  // Declarative instance-state write: the renderer generates a patch op
  // (appended to this task's operations) that copies the value sources into
  // the instance state via ctx.patchWorkflowInstanceState.
  patch?: Record<string, ValueSpec>;
  // Declares a structured completion contract: the renderer generates a
  // completion tool with these fields (all required), the agent calls it to
  // end the task, and the parsed arguments become the task output. Only on
  // ai-task/ai-chat; mutually exclusive with an explicit completionTool.
  completionOutput?: CompletionOutputField[];
};

export type AutoTransitionSpec = {
  to: string;
  gate: GateSpec;
};

export type ActionSpec = {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "destructive" | "default";
  transitionTo?: string;
  gate?: GateSpec;
  maxWorkflowInstancesInTarget?: number;
  dependsOnState?: string;
  newAttempt?: boolean;
  completesRunningTask?: boolean;
  // Custom wording for the two-click confirm step. Destructive actions confirm
  // by default; declaring this implies a confirm for any variant and
  // overrides the wording (the "confirm + reason" pattern pairs it with
  // `fields`).
  confirmText?: string;
  createInstance?: { workflowId: string; fields: ConfigField[] };
  // Declared input fields collected from the user when this action is
  // dispatched: the values are written into the acting instance's
  // workflowInstanceState before the transition (a correction note, reject
  // reason, or due date travels with the action).
  fields?: ConfigField[];
};

export type StateSpec = {
  id: string;
  label: string;
  category?: "initial" | "active" | "terminal" | "error";
  tasks?: TaskSpec[];
  autoTransitions?: AutoTransitionSpec[];
  actions?: ActionSpec[];
};

export type WorkflowSpec = {
  id: string;
  label: string;
  description?: string;
  instance?: { title?: string; subtitle?: string };
  ui?: { view?: WorkflowView; columns?: BoardColumn[] };
  display?: {
    fields: {
      path: string;
      label?: string;
      render?: RuntimeRenderHint;
      derive?: DerivedDisplay;
    }[];
  };
  // Optional curated set of instance-state fields a user may edit in place via
  // the instance-edit form. Keys must be declared in instanceState (validated).
  editFields?: ConfigField[];
  instanceState: InstanceStateField[];
  initialState: string;
  terminalStates: string[];
  states: StateSpec[];
};

export type EdgeSpec = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow: string;
  fields?: Record<string, ValueSpec>;
  fanOut?: {
    task: string;
    path: string;
    fields: Record<string, FanOutValueSpec>;
  };
};

export type FlowLevelActionSpec = {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "destructive" | "default";
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

export type FlowBlueprint = {
  id: string;
  label: string;
  description?: string;
  configSchema: ConfigField[];
  domainDir?: string;
  ui?: { view?: WorkflowView };
  workflows: WorkflowSpec[];
  edges?: EdgeSpec[];
  actions?: FlowLevelActionSpec[];
};

// ─── validation ───────────────────────────────────────────────────────

export type BlueprintError = { path: string; message: string };

// The cross-cutting context validateFlowBlueprint builds while walking workflows;
// the edge and writer validators that run afterwards receive it.
export type BlueprintValidationContext = {
  workflowById: Map<string, WorkflowSpec>;
  stateIdsByWorkflow: Map<string, Set<string>>;
  taskIdsByWorkflow: Map<string, Set<string>>;
  instanceStateById: Map<string, Map<string, FieldType>>;
  completionOutputById: Map<string, Map<string, CompletionOutputField[]>>;
};
