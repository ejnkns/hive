/** @private — the flow-definition vocabulary: the pure-data authoring surface
 * an agent writes and a UI builder edits. The definition is the single
 * artifact — the engine compiles it to the runtime projection at
 * registration (compile-flow-definition.ts). Everything here is data: gates
 * are structured predicates (`GateSpec`), values are a small set of sources
 * (`ValueSpec`), and arbitrary logic is always a referenced module (a file
 * ref). No closures — a visual editor must serialize and round-trip this
 * shape. */

import type { BoardColumn, WorkflowView } from "./actions.ts";
import type { ConfigField } from "./config-field.ts";
import type { RuntimeRenderHint } from "./render-hints.ts";

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

// A declared flow-level state field (E2). FlowState is cross-entity data the
// engine's operations write (patchFlowState) and the flow's tools read — not
// user input — so it uses the instance-state field vocabulary (FieldType
// includes object/object[] for structured values like a taxonomy), not the
// ConfigField input vocabulary.
export type FlowStateField = { field: string; type: FieldType };

// A structured completion contract on an ai-task/ai-chat: the compiler
// generates a completion tool with exactly these fields (all required); the
// agent calls it to end the task; the parsed arguments become the task output
// (so patch ops read output.<field> and gates compare output.<field>).
// An ai-chat runner wraps the parsed arguments as `output.completion` next to
// the transcript, so reads of an ai-chat contract address
// `output.completion.<field>`.
export type CompletionOutputField = {
  field: string;
  type: FieldType;
  description?: string;
};

// A task's declared structured completion contract, with the role that
// determines where the parsed arguments surface in the task output: directly
// (ai-task: `output.<field>`) or wrapped by the ai-chat transcript
// (`output.completion.<field>`).
export type CompletionContract = {
  role: "ai-task" | "ai-chat";
  fields: CompletionOutputField[];
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

// A definition-referenced code module — the closed vocabulary of reference
// kinds. The compiler resolves each ref to its module and uses the named
// export; the module-set gate lints the referenced files against the same
// contract types.
export type ModuleRefKind =
  | "gate"
  | "tool"
  | "operation"
  | "transform"
  | "extract"
  | "prompt";

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
  | { kind: "or"; gates: GateSpec[] }
  // A gate implemented in a referenced file: `ref` is a relative path inside
  // the definition root whose named export is `(ctx: RuntimeGateContext) =>
  // boolean`. Nested in not/and/or like any other gate.
  | { kind: "file"; ref: string };

// A custom tool the flow ships: the file's `<id>Tools` export is a list of
// self-contained tools (defineTool) merged into the definition's tools.
// `writes` declares the instance-state fields the tools' executors patch —
// the read↔write invariant counts them as writers for the workflows whose
// tasks use the tool (the module-set schema-consistency check verifies the
// declared writes against the actual executor bodies).
export type ToolRefSpec = { id: string; ref: string; writes?: string[] };

// A custom operation the flow ships: the file's `<id>Operations` export is a
// defineOperations map merged into the definition's operations. Tasks
// reference the op by `id`. `writes` declares the instance-state fields the
// op patches on its own instance (the read↔write invariant counts them as
// writers for the workflows whose tasks use the op; the module-set
// schema-consistency check verifies against the actual op body).
// `writesAcross` declares the op's cross-instance writes (E1): per target
// workflow, the instance-state fields the op patches on SIBLING instances
// via `ctx.patchInstanceState(instanceId, patch)`. The schema-consistency
// check verifies those fields against the target workflow's declared
// instanceState and the actual op body — a sibling patch the op does not
// declare is rejected by the module-set gate.
export type CrossInstanceWriteDecl = { workflow: string; fields: string[] };
export type OperationRefSpec = {
  id: string;
  ref: string;
  writes?: string[];
  writesAcross?: CrossInstanceWriteDecl[];
};

// An edge transform implemented in a referenced file. `fields` declares the
// target instance-state fields the transform produces — the compiler wraps
// the imported transform so the schema-consistency check sees the writes.
export type EdgeTransformRefSpec = { ref: string; fields: string[] };

// A task output extractor implemented in a referenced file: an operation task
// whose generated op runs the extractor on the instance's task outputs and
// merges the returned fields into instance state. `fields` declares those
// fields (must be declared instance-state fields).
export type ExtractRefSpec = { ref: string; fields: string[] };

export type TaskSpec = {
  id: string;
  label?: string;
  role: "operation" | "ai-task" | "ai-chat";
  // Engine operation names, ids of flow-level operations, or inline
  // references to a custom operation module (`{ ref }` — the op is registered
  // under the export name from `<ref>` and the task runs it).
  operations?: (string | { ref: string })[];
  operationInputs?: Record<string, unknown>;
  tools?: string[];
  completionTool?: string;
  completionSignal?: string;
  // The task's system prompt, inline or as a referenced file. `systemPromptRef`
  // points at a module whose named export (the camel-cased file base name) is
  // the prompt string — the compiler imports it. Mutually exclusive with
  // `systemPrompt`.
  systemPrompt?: string;
  systemPromptRef?: string;
  startOnUserInput?: boolean;
  workspacePath?: string;
  inputFromInstanceState?: string;
  persist?: { path: string };
  // How the task's completed output renders in the generic UI. Pure data.
  render?: RuntimeRenderHint;
  // Declarative instance-state write: the compiler generates a patch op
  // (appended to this task's operations) that copies the value sources into
  // the instance state via ctx.patchWorkflowInstanceState.
  patch?: Record<string, ValueSpec>;
  // Declares a structured completion contract: the compiler generates a
  // completion tool with these fields (all required), the agent calls it to
  // end the task, and the parsed arguments become the task output. Only on
  // ai-task/ai-chat; mutually exclusive with an explicit completionTool.
  completionOutput?: CompletionOutputField[];
  // A referenced output extractor: the generated op runs the referenced
  // extractor over the instance's task outputs and patches the declared
  // `fields` into instance state. Operation tasks only.
  extract?: ExtractRefSpec;
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
  // E5: the action removes the instance from the flow when it fires (no
  // transition target). Destructive variants only; mutually exclusive with
  // transitionTo. The engine drops the controller, deletes the persisted
  // state, and notifies listeners; title-based references to the removed
  // instance go stale gracefully.
  deletesInstance?: boolean;
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
  description?: string;
  category?: "initial" | "active" | "terminal" | "error";
  tasks?: TaskSpec[];
  autoTransitions?: AutoTransitionSpec[];
  actions?: ActionSpec[];
};

// A display field's render hint: the object form ({ kind, props? }) or the
// bare-kind shorthand ("markdown" — the compiler normalizes it to
// { kind: "markdown" }). The kind is open — a definition may declare custom
// kinds in ui.kinds and reference them here (a hand-authored definition could
// before; the definition makes it a data field).
export type DisplayFieldRender =
  | { kind: string; props?: Record<string, string> }
  | string;

export type DisplayFieldSpec = {
  path: string;
  label?: string;
  render?: DisplayFieldRender;
  derive?: import("./display.ts").DerivedDisplay;
};

export type WorkflowSpec = {
  id: string;
  label: string;
  description?: string;
  instance?: { title?: string; subtitle?: string };
  ui?: {
    view?: WorkflowView;
    columns?: BoardColumn[];
    // A served component id (a key of the flow's `ui.components`) that renders
    // this workflow's instances instead of the default card.
    instanceComponent?: string;
    // A served component id (a key of the flow's `ui.components`) that renders
    // this workflow's ENTIRE workflow-instances section (replacing the generic
    // grouped board/list). The workflow-component contract is the same
    // default-export factory; the section renderer resolves it through the
    // component registry and falls back to the grouped board when unknown.
    workflowComponent?: string;
    // E3: group the board by the distinct values of a declared instance-state
    // field — one column per value plus an "uncategorized" column for
    // instances missing the value. A generic partition: the engine/UI never
    // reads or interprets the values (no labels, ordering, or semantics — the
    // domain maps values to labels via display hints if it wants). Mutually
    // exclusive with `columns` (field grouping replaces state columns).
    groupByField?: string;
  };
  display?: { fields: DisplayFieldSpec[] };
  // Optional curated set of instance-state fields a user may edit in place via
  // the instance-edit form. Keys must be declared in instanceState (validated).
  editFields?: ConfigField[];
  instanceState: InstanceStateField[];
  initial: string;
  terminalStates: string[];
  states: StateSpec[];
};

export type EdgeSpec = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow?: string;
  // E2: when true, the edge's transform output updates FlowState instead of
  // creating new instances. The transform's declared fields must be declared
  // flowState fields. Mutually exclusive with toWorkflow.
  toFlowState?: boolean;
  // When the edge fires (the source reaches one of fromStates — always a
  // terminal state), dispatch `actionId` to EVERY instance of `toWorkflow`
  // through the same availability path as a manual click (state check +
  // gates; unavailable → silent no-op). With `createIfNone`, create the
  // target instance first when none exists — the edge's `fields` seed its
  // state and its initial-state auto-tasks run. This is the declarative
  // "refresh the singleton aggregate when work lands" primitive. Mutually
  // exclusive with `fanOut`/`transform`; `fields` is allowed alongside.
  autoDispatch?: { actionId: string; createIfNone?: boolean };
  // Value-source transforms (mutually exclusive with `transform`):
  fields?: Record<string, ValueSpec>;
  fanOut?: {
    task: string;
    path: string;
    fields: Record<string, FanOutValueSpec>;
  };
  // A transform implemented in a referenced file. `fields` declares the target
  // instance-state fields the transform produces (mutually exclusive with
  // `fields`/`fanOut` — the reference IS the transform).
  transform?: EdgeTransformRefSpec;
};

export type FlowLevelActionSpec = {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "destructive" | "default";
  // A visibility gate evaluated against the flow-level runtime context (e.g.
  // a cross-instance file gate). Structured instance/task gates do not apply
  // at the flow level — the validator rejects them.
  gate?: GateSpec;
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

// ─── validation ───────────────────────────────────────────────────────

// The flow-level theme tokens, mirrored from flow-definition.ts so the
// vocabulary stays the complete authoring surface (same pure-data contract as
// kinds/components — a definition may declare `ui.theme` as data).
export type { FlowThemeSpec } from "./flow-definition.ts";

export type DefinitionError = { path: string; message: string };

// The cross-cutting context the definition validator builds while walking
// workflows; the edge and writer validators that run afterwards receive it.
export type DefinitionValidationContext = {
  workflowById: Map<string, WorkflowSpec>;
  stateIdsByWorkflow: Map<string, Set<string>>;
  taskIdsByWorkflow: Map<string, Set<string>>;
  instanceStateById: Map<string, Map<string, FieldType>>;
  completionOutputById: Map<string, Map<string, CompletionContract>>;
  // Flow-level custom capabilities' declared instance-state writes, keyed by
  // id; the writer validator counts them for workflows whose tasks use them.
  toolWritesById: Map<string, string[]>;
  operationWritesById: Map<string, string[]>;
  // Flow-level custom operations' declared cross-instance writes (E1), keyed
  // by op id: per target workflow, the instance-state fields the op patches
  // on sibling instances. The writer validator counts them for the TARGET
  // workflows; the module-set gate verifies them against the actual bodies.
  operationWritesAcrossById: Map<string, CrossInstanceWriteDecl[]>;
};
