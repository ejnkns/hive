/** @public — the flow-authoring spec: the structured description an AI emits
 * and the renderer turns into a TypeScript definition.
 *
 * The spec is deliberately a closed, validated vocabulary — no expression
 * language. Gates are structured predicates (`GateSpec`), values are a small
 * set of sources (`ValueSpec`), and anything outside the vocabulary fails
 * validation with a model-actionable message (the flow is then finished by
 * hand in the editor).
 *
 * Validation mirrors the schema-consistency check's invariants *at the spec
 * level* so the model gets precise feedback before anything is rendered:
 *   - identifiers must be valid TS identifiers (they become type names and
 *     property accesses);
 *   - every reference resolves (workflow/state/task ids, op names, tool
 *     names, transition targets, edge targets);
 *   - every instance-state read (gates, hints, inputFromInstanceState,
 *     @instance: refs, dependsOnState) has a writer (patch ops, edge fields,
 *     createInstance payload keys, engine ops) — engine-provided fields
 *     (worktreePath/branchName/attempt) are exempt;
 *   - every write is declared in the target workflow's instanceState;
 *   - completionTool is `complete_task` (the only completion tool the engine
 *     ships that needs no domain code). */

import { engineCapabilities } from "workflow-engine/capabilities-manifest";
import type {
  BoardColumn,
  ConfigField,
  RuntimeRenderHint,
  WorkflowView,
} from "workflow-engine/workflow-types";

// ─── the spec types ───────────────────────────────────────────────────

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "boolean[]"
  | "object";

export type InstanceStateField = { field: string; type: FieldType };

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
  createInstance?: { workflowId: string; fields: ConfigField[] };
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
    fields: { path: string; label?: string; render?: RuntimeRenderHint }[];
  };
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

export type FlowSpec = {
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

export type SpecError = { path: string; message: string };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DOTTED_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

const infraToolNames = new Set<string>(
  engineCapabilities.infrastructureTools.map((t) => t.name)
);
const engineOpNames = new Set<string>(
  engineCapabilities.engineOperations.map((o) => o.name)
);
const engineOpWritesByName = new Map<string, Set<string>>(
  engineCapabilities.engineOperations.map((o) => [o.name, new Set(o.writes)])
);
const ENGINE_PROVIDED = new Set(
  Object.keys(engineCapabilities.stateFields.engineProvided)
);

const FIELD_TYPES: Record<FieldType, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  "string[]": "string[]",
  "number[]": "number[]",
  "boolean[]": "boolean[]",
  object: "object",
};

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && value in FIELD_TYPES;
}

function isConfigField(value: unknown): value is ConfigField {
  if (typeof value !== "object" || value === null) return false;
  const field = value as Record<string, unknown>;
  return (
    typeof field.key === "string" &&
    typeof field.label === "string" &&
    (field.type === "string" ||
      field.type === "boolean" ||
      field.type === "number")
  );
}

export function validateFlowSpec(spec: FlowSpec): SpecError[] {
  const errors: SpecError[] = [];
  const error = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  // ── flow level ──
  if (typeof spec.id !== "string" || !IDENTIFIER.test(spec.id)) {
    error(
      "id",
      `flow id must be a valid identifier (got ${JSON.stringify(spec.id)})`
    );
  }
  if (typeof spec.label !== "string" || spec.label.trim() === "") {
    error("label", "flow label is required");
  }
  if (!Array.isArray(spec.workflows) || spec.workflows.length === 0) {
    error("workflows", "a flow needs at least one workflow");
  }
  if (!Array.isArray(spec.configSchema)) {
    error("configSchema", "configSchema must be an array");
  } else {
    spec.configSchema.forEach((field, i) => {
      if (!isConfigField(field)) {
        error(
          `configSchema[${i}]`,
          `invalid config field: ${JSON.stringify(field)}`
        );
      }
    });
  }

  const workflowById = new Map<string, WorkflowSpec>();
  const stateIdsByWorkflow = new Map<string, Set<string>>();
  const taskIdsByWorkflow = new Map<string, Set<string>>();
  const instanceStateById = new Map<string, Map<string, FieldType>>();

  // ── workflows ──
  for (const [wfIndex, wf] of spec.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    if (typeof wf.id !== "string" || !IDENTIFIER.test(wf.id)) {
      error(
        `${wfPath}.id`,
        `workflow id must be a valid identifier (got ${JSON.stringify(wf.id)})`
      );
      continue; // cannot index the rest meaningfully
    }
    if (workflowById.has(wf.id)) {
      error(`${wfPath}.id`, `duplicate workflow id "${wf.id}"`);
    }
    workflowById.set(wf.id, wf);
    if (typeof wf.label !== "string" || wf.label.trim() === "") {
      error(`${wfPath}.label`, "workflow label is required");
    }
    if (!Array.isArray(wf.instanceState)) {
      error(`${wfPath}.instanceState`, "instanceState must be an array");
    }

    const stateIds = new Set<string>();
    const taskIds = new Set<string>();
    stateIdsByWorkflow.set(wf.id, stateIds);
    taskIdsByWorkflow.set(wf.id, taskIds);
    const stateTypes = new Map<string, FieldType>();
    instanceStateById.set(wf.id, stateTypes);

    if (Array.isArray(wf.instanceState)) {
      wf.instanceState.forEach((field, i) => {
        if (!field || !IDENTIFIER.test(field.field)) {
          error(
            `${wfPath}.instanceState[${i}]`,
            `field name must be a valid identifier (got ${JSON.stringify(field?.field)})`
          );
          return;
        }
        if (!isFieldType(field.type)) {
          error(
            `${wfPath}.instanceState[${i}].type`,
            `invalid field type ${JSON.stringify(field.type)} (valid: ${Object.keys(FIELD_TYPES).join(", ")})`
          );
          return;
        }
        if (stateTypes.has(field.field)) {
          error(
            `${wfPath}.instanceState[${i}]`,
            `duplicate instance-state field "${field.field}"`
          );
        }
        stateTypes.set(field.field, field.type);
      });
    }

    for (const [sIndex, state] of wf.states.entries()) {
      const sPath = `${wfPath}.states[${sIndex}]`;
      if (typeof state.id !== "string" || !IDENTIFIER.test(state.id)) {
        error(
          `${sPath}.id`,
          `state id must be a valid identifier (got ${JSON.stringify(state.id)})`
        );
        continue;
      }
      if (stateIds.has(state.id)) {
        error(`${sPath}.id`, `duplicate state id "${state.id}"`);
      }
      stateIds.add(state.id);
      if (typeof state.label !== "string" || state.label.trim() === "") {
        error(`${sPath}.label`, "state label is required");
      }
      if (
        state.category !== undefined &&
        !["initial", "active", "terminal", "error"].includes(state.category)
      ) {
        error(
          `${sPath}.category`,
          `invalid category ${JSON.stringify(state.category)}`
        );
      }

      for (const [tIndex, task] of (state.tasks ?? []).entries()) {
        const tPath = `${sPath}.tasks[${tIndex}]`;
        if (typeof task.id !== "string" || !IDENTIFIER.test(task.id)) {
          error(
            `${tPath}.id`,
            `task id must be a valid identifier (got ${JSON.stringify(task.id)})`
          );
          continue;
        }
        if (taskIds.has(task.id)) {
          error(
            `${tPath}.id`,
            `duplicate task id "${task.id}" across the workflow`
          );
        }
        taskIds.add(task.id);
        if (!["operation", "ai-task", "ai-chat"].includes(task.role)) {
          error(
            `${tPath}.role`,
            `invalid task role ${JSON.stringify(task.role)}`
          );
        }
        if (task.patch !== undefined) {
          if (task.role !== "operation") {
            error(
              `${tPath}.patch`,
              `patch writes require an operation task (they run as a sibling op that reads another task's output); ${task.id} is ${task.role}`
            );
          }
          for (const field of Object.keys(task.patch)) {
            if (!stateTypes.has(field)) {
              error(
                `${tPath}.patch.${field}`,
                `patch writes "${field}" which is not declared in instanceState`
              );
            }
          }
          for (const [field, value] of Object.entries(task.patch)) {
            const declaredType = stateTypes.get(field);
            if (value.kind === "literal" && declaredType) {
              for (const e of checkLiteralMatches(
                value.value,
                declaredType,
                `${tPath}.patch.${field}`
              )) {
                error(e.path, e.message);
              }
            }
            if (value.kind === "instanceId" && declaredType !== "string") {
              error(
                `${tPath}.patch.${field}`,
                `instanceId values require a string field (${field} is ${declaredType})`
              );
            }
          }
        }
      }
    }

    // Pass 2 — task-level references (needs the full task id set).
    for (const [sIndex, state] of wf.states.entries()) {
      const sPath = `${wfPath}.states[${sIndex}]`;
      for (const [tIndex, task] of (state.tasks ?? []).entries()) {
        const tPath = `${sPath}.tasks[${tIndex}]`;
        if (typeof task.id !== "string" || !taskIds.has(task.id)) continue;
        for (const op of task.operations ?? []) {
          if (!engineOpNames.has(op)) {
            error(
              `${tPath}.operations`,
              `unknown engine operation "${op}" (available: ${[...engineOpNames].sort().join(", ")})`
            );
          }
        }
        for (const tool of task.tools ?? []) {
          if (!infraToolNames.has(tool)) {
            error(
              `${tPath}.tools`,
              `unknown tool "${tool}" (available: ${[...infraToolNames].sort().join(", ")})`
            );
          }
        }
        if (
          task.completionTool !== undefined &&
          task.completionTool !== "complete_task"
        ) {
          error(
            `${tPath}.completionTool`,
            `completionTool must be "complete_task" (the engine's generic completion tool) in generated flows, got ${JSON.stringify(task.completionTool)}`
          );
        }
        if (
          task.workspacePath !== undefined &&
          !task.workspacePath.startsWith("@instance:")
        ) {
          error(
            `${tPath}.workspacePath`,
            `workspacePath must be a literal directory or "@instance:<field>" (got ${JSON.stringify(task.workspacePath)})`
          );
        }
        if (
          task.inputFromInstanceState !== undefined &&
          !DOTTED_PATH.test(task.inputFromInstanceState)
        ) {
          error(
            `${tPath}.inputFromInstanceState`,
            `inputFromInstanceState must be a dotted path (got ${JSON.stringify(task.inputFromInstanceState)})`
          );
        }
        for (const [field, value] of Object.entries(task.patch ?? {})) {
          for (const e of validateValueSpec(
            value,
            taskIds,
            `${tPath}.patch.${field}`
          )) {
            error(e.path, e.message);
          }
        }
      }
    }

    // Pass 3 — transitions and actions (needs the full state/task id sets).
    for (const [sIndex, state] of wf.states.entries()) {
      const sPath = `${wfPath}.states[${sIndex}]`;
      for (const [tIndex, transition] of (
        state.autoTransitions ?? []
      ).entries()) {
        const aPath = `${sPath}.autoTransitions[${tIndex}]`;
        if (typeof transition.to !== "string" || !stateIds.has(transition.to)) {
          error(
            `${aPath}.to`,
            `autoTransition targets unknown state ${JSON.stringify(transition.to)} (states: ${[...stateIds].join(", ")})`
          );
        }
        for (const e of validateGateSpec(
          transition.gate,
          taskIds,
          stateTypes,
          `${aPath}.gate`
        )) {
          error(e.path, e.message);
        }
      }

      for (const [aIndex, action] of (state.actions ?? []).entries()) {
        const aPath = `${sPath}.actions[${aIndex}]`;
        if (typeof action.id !== "string" || !IDENTIFIER.test(action.id)) {
          error(`${aPath}.id`, `action id must be a valid identifier`);
        }
        if (
          action.transitionTo !== undefined &&
          !stateIds.has(action.transitionTo)
        ) {
          error(
            `${aPath}.transitionTo`,
            `action targets unknown state ${JSON.stringify(action.transitionTo)}`
          );
        }
        if (
          action.dependsOnState !== undefined &&
          !stateIds.has(action.dependsOnState)
        ) {
          error(
            `${aPath}.dependsOnState`,
            `dependsOnState targets unknown state ${JSON.stringify(action.dependsOnState)}`
          );
        }
        if (action.gate) {
          for (const e of validateGateSpec(
            action.gate,
            taskIds,
            stateTypes,
            `${aPath}.gate`
          )) {
            error(e.path, e.message);
          }
        }
        if (action.createInstance) {
          for (const e of validateCreateInstance(
            action.createInstance,
            workflowById,
            instanceStateById,
            `${aPath}.createInstance`
          )) {
            error(e.path, e.message);
          }
        }
      }
    }

    if (typeof wf.initialState !== "string" || !stateIds.has(wf.initialState)) {
      error(
        `${wfPath}.initialState`,
        `initialState must be one of the workflow's states (states: ${[...stateIds].join(", ")})`
      );
    }
    for (const terminal of wf.terminalStates) {
      if (!stateIds.has(terminal)) {
        error(
          `${wfPath}.terminalStates`,
          `terminal state ${JSON.stringify(terminal)} is not one of the workflow's states`
        );
      }
    }

    // instance/display hint reads must be declared fields.
    if (wf.instance && wf.instance.title === undefined) {
      error(`${wfPath}.instance`, "instance hint requires a `title`");
    }
    for (const key of ["title", "subtitle"] as const) {
      const value = wf.instance?.[key];
      if (value !== undefined) {
        const first = value.split(".")[0];
        if (!stateTypes.has(first)) {
          error(
            `${wfPath}.instance.${key}`,
            `instance hint references undeclared state field "${first}" (declared: ${[...stateTypes.keys()].join(", ")})`
          );
        }
      }
    }
    for (const [dIndex, field] of (wf.display?.fields ?? []).entries()) {
      const first = field.path.split(".")[0];
      if (!stateTypes.has(first)) {
        error(
          `${wfPath}.display.fields[${dIndex}].path`,
          `display hint references undeclared state field "${first}"`
        );
      }
    }

    if (wf.ui) {
      if (
        wf.ui.view !== undefined &&
        !["board", "list", "document", "chat"].includes(wf.ui.view)
      ) {
        error(
          `${wfPath}.ui.view`,
          `invalid ui.view ${JSON.stringify(wf.ui.view)} (valid: board, list, document, chat)`
        );
      }
      for (const [cIndex, column] of (wf.ui.columns ?? []).entries()) {
        for (const stateId of column.states) {
          if (!stateIds.has(stateId)) {
            error(
              `${wfPath}.ui.columns[${cIndex}].states`,
              `column folds unknown state ${JSON.stringify(stateId)}`
            );
          }
        }
      }
    }

    // taskOutputEquals paths must address the outcome's output and stay
    // prefix-consistent per task (the renderer derives the output type from
    // them: whole-output and deep paths can't coexist, and a path cannot be
    // a prefix of another on the same task).
    const outputPathsPerTask = new Map<string, Set<string>>();
    const pathsForTask = (task: string): Set<string> => {
      let set = outputPathsPerTask.get(task);
      if (!set) {
        set = new Set();
        outputPathsPerTask.set(task, set);
      }
      return set;
    };
    const visitGateForPaths = (gate: GateSpec) => {
      if (gate.kind === "taskOutputEquals") {
        if (gate.path === "output") {
          pathsForTask(gate.task).add("");
        } else if (gate.path.startsWith("output.")) {
          pathsForTask(gate.task).add(gate.path.slice("output.".length));
        } else {
          error(
            `${wfPath}`,
            `taskOutputEquals path must start with "output" (the task's output), got ${JSON.stringify(gate.path)}`
          );
        }
      } else if (gate.kind === "not") {
        visitGateForPaths(gate.gate);
      } else if (gate.kind === "and" || gate.kind === "or") {
        for (const g of gate.gates) visitGateForPaths(g);
      }
    };
    for (const state of wf.states) {
      for (const transition of state.autoTransitions ?? []) {
        visitGateForPaths(transition.gate);
      }
      for (const action of state.actions ?? []) {
        if (action.gate) visitGateForPaths(action.gate);
      }
    }
    for (const [task, paths] of outputPathsPerTask) {
      const sorted = [...paths].sort((a, b) => a.length - b.length);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (
            sorted[i] === "" ||
            sorted[j].startsWith(`${sorted[i]}.`) ||
            sorted[i] === sorted[j]
          ) {
            error(
              `${wfPath}`,
              `task "${task}" has conflicting taskOutputEquals paths: ${[...paths].map((p) => (p === "" ? "output" : `output.${p}`)).join(", ")} (whole-output and deep paths cannot mix on the same task)`
            );
            break;
          }
        }
      }
    }
  }

  // ── flow-level actions ──
  for (const [aIndex, action] of (spec.actions ?? []).entries()) {
    const aPath = `actions[${aIndex}]`;
    if (typeof action.id !== "string" || !IDENTIFIER.test(action.id)) {
      error(`${aPath}.id`, "action id must be a valid identifier");
    }
    if (action.createInstance) {
      for (const e of validateCreateInstance(
        action.createInstance,
        workflowById,
        instanceStateById,
        `${aPath}.createInstance`
      )) {
        error(e.path, e.message);
      }
    }
    if (action.dispatchToAll) {
      const target = workflowById.get(action.dispatchToAll.workflowId);
      if (!target) {
        error(
          `${aPath}.dispatchToAll.workflowId`,
          `dispatchToAll targets unknown workflow ${JSON.stringify(action.dispatchToAll.workflowId)}`
        );
      } else {
        const stateIds = stateIdsByWorkflow.get(target.id);
        // The referenced action must exist somewhere in the target workflow.
        const exists = target.states.some((s) =>
          (s.actions ?? []).some((a) => a.id === action.dispatchToAll?.actionId)
        );
        if (!exists) {
          error(
            `${aPath}.dispatchToAll.actionId`,
            `dispatchToAll references action "${action.dispatchToAll.actionId}" which no state of workflow "${target.id}" declares`
          );
        }
        void stateIds;
      }
    }
  }

  // ── edges ──
  for (const [eIndex, edge] of (spec.edges ?? []).entries()) {
    const ePath = `edges[${eIndex}]`;
    const from = workflowById.get(edge.fromWorkflow);
    const to = workflowById.get(edge.toWorkflow);
    if (!from) {
      error(
        `${ePath}.fromWorkflow`,
        `unknown source workflow ${JSON.stringify(edge.fromWorkflow)}`
      );
      continue;
    }
    if (!to) {
      error(
        `${ePath}.toWorkflow`,
        `unknown target workflow ${JSON.stringify(edge.toWorkflow)}`
      );
      continue;
    }
    const fromStates = stateIdsByWorkflow.get(from.id);
    const fromTaskIds = taskIdsByWorkflow.get(from.id);
    const toTypes = instanceStateById.get(to.id);
    if (!fromStates || !fromTaskIds || !toTypes) continue;
    for (const state of edge.fromStates) {
      if (!fromStates.has(state)) {
        error(
          `${ePath}.fromStates`,
          `source workflow "${from.id}" has no state ${JSON.stringify(state)}`
        );
      }
    }
    for (const [field, value] of Object.entries(edge.fields ?? {})) {
      const type = toTypes.get(field);
      if (!type) {
        error(
          `${ePath}.fields.${field}`,
          `edge writes "${field}" which is not declared in target workflow "${to.id}" instanceState`
        );
      }
      for (const e of validateValueSpec(
        value,
        fromTaskIds,
        `${ePath}.fields.${field}`
      )) {
        error(e.path, e.message);
      }
      if (value.kind === "instanceId") {
        error(
          `${ePath}.fields.${field}`,
          `instanceId values are only valid in patch ops, not edge transforms`
        );
      }
      if (value.kind === "literal" && type) {
        for (const e of checkLiteralMatches(
          value.value,
          type,
          `${ePath}.fields.${field}`
        )) {
          error(e.path, e.message);
        }
      }
    }
    if (edge.fanOut) {
      const fan = edge.fanOut;
      if (!fromTaskIds.has(fan.task)) {
        error(
          `${ePath}.fanOut.task`,
          `fanOut reads task "${fan.task}" which source workflow "${from.id}" does not declare`
        );
      }
      if (typeof fan.path !== "string" || !DOTTED_PATH.test(fan.path)) {
        error(`${ePath}.fanOut.path`, `fanOut path must be a dotted path`);
      }
      for (const [field, value] of Object.entries(fan.fields)) {
        const type = toTypes.get(field);
        if (!type) {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `fanOut writes "${field}" which is not declared in target workflow "${to.id}" instanceState`
          );
        }
        if (value.kind === "literal") {
          if (type) {
            for (const e of checkLiteralMatches(
              value.value,
              type,
              `${ePath}.fanOut.fields.${field}`
            )) {
              error(e.path, e.message);
            }
          }
          continue;
        }
        if (value.kind === "instanceId") {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `instanceId values are only valid in patch ops, not fan-out fields`
          );
          continue;
        }
        if (value.kind === "itemPath" && !DOTTED_PATH.test(value.path)) {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `itemPath must be a dotted path (got ${JSON.stringify(value.path)})`
          );
        }
      }
    }
  }

  // ── the missing-writer invariant, at the spec level ──
  for (const [wfIndex, wf] of spec.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    const stateTypes = instanceStateById.get(wf.id);
    const taskIds = taskIdsByWorkflow.get(wf.id);
    if (!stateTypes || !taskIds) continue;

    const writes: Set<string> = new Set();
    // 1. this workflow's patch ops
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const field of Object.keys(task.patch ?? {})) writes.add(field);
      }
    }
    // 2. engine ops used by this workflow's tasks that write state
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const op of task.operations ?? []) {
          for (const field of engineOpWritesByName.get(op) ?? []) {
            writes.add(field);
          }
        }
      }
    }
    // 3. edges into this workflow
    for (const edge of spec.edges ?? []) {
      if (edge.toWorkflow !== wf.id) continue;
      for (const field of Object.keys(edge.fields ?? {})) writes.add(field);
      if (edge.fanOut) {
        for (const field of Object.keys(edge.fanOut.fields)) writes.add(field);
      }
    }
    // 4. createInstance payload keys into this workflow (state + flow level)
    for (const state of wf.states) {
      for (const action of state.actions ?? []) {
        if (action.createInstance?.workflowId === wf.id) {
          for (const field of action.createInstance.fields)
            writes.add(field.key);
        }
      }
    }
    for (const action of spec.actions ?? []) {
      if (action.createInstance?.workflowId === wf.id) {
        for (const field of action.createInstance.fields) writes.add(field.key);
      }
    }

    const allWrites = new Set([...writes, ...ENGINE_PROVIDED]);
    const reads: Set<string> = new Set();

    for (const state of wf.states) {
      for (const transition of state.autoTransitions ?? []) {
        collectGateStateReads(transition.gate, reads);
      }
      for (const action of state.actions ?? []) {
        if (action.gate) collectGateStateReads(action.gate, reads);
        if (action.dependsOnState !== undefined) reads.add("dependsOn");
      }
      for (const task of state.tasks ?? []) {
        if (task.workspacePath?.startsWith("@instance:")) {
          reads.add(task.workspacePath.slice("@instance:".length));
        }
        if (task.inputFromInstanceState) {
          reads.add(task.inputFromInstanceState.split(".")[0]);
        }
      }
    }
    for (const key of ["title", "subtitle"] as const) {
      const value = wf.instance?.[key];
      if (value !== undefined) reads.add(value.split(".")[0]);
    }
    for (const field of wf.display?.fields ?? []) {
      reads.add(field.path.split(".")[0]);
    }

    for (const field of reads) {
      if (allWrites.has(field)) continue;
      error(
        `${wfPath}`,
        `instance-state field "${field}" is read but nothing writes it (writers: patches, edges, createInstance payloads, engine ops; engine-provided: ${[...ENGINE_PROVIDED].join(", ")})`
      );
    }
    // dependsOnState implies the dependsOn field must be declared + written.
    const usesDependsOn = wf.states.some((s) =>
      (s.actions ?? []).some((a) => a.dependsOnState !== undefined)
    );
    if (usesDependsOn) {
      if (!stateTypes.has("dependsOn")) {
        error(
          `${wfPath}`,
          `dependsOnState is used but instanceState does not declare "dependsOn" (a string[] of instance ids/titles the engine resolves)`
        );
      } else if (!writes.has("dependsOn")) {
        error(
          `${wfPath}`,
          `dependsOnState is used but nothing writes "dependsOn" (write it from an edge or a patch op)`
        );
      }
    }
    void taskIds;
  }

  return errors;
}

// ── helper validators ─────────────────────────────────────────────────

function validateValueSpec(
  value: ValueSpec,
  taskIds: Set<string>,
  path: string
): SpecError[] {
  const errors: SpecError[] = [];
  if (value.kind === "literal") return errors;
  if (value.kind === "instanceId") return errors;
  if (value.kind === "taskOutput") {
    if (!taskIds.has(value.task)) {
      errors.push({
        path,
        message: `value source reads task "${value.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`,
      });
    }
    if (typeof value.path !== "string" || !DOTTED_PATH.test(value.path)) {
      errors.push({
        path,
        message: `taskOutput path must be a dotted path (got ${JSON.stringify(value.path)})`,
      });
    }
  }
  return errors;
}

// A literal's runtime type must match the declared field type, or the
// rendered code fails to typecheck (`title: 3` vs `title?: string`).
function checkLiteralMatches(
  value: string | number | boolean,
  fieldTypeName: FieldType,
  path: string
): SpecError[] {
  if (fieldTypeName === "object" || fieldTypeName.endsWith("[]")) {
    return [
      {
        path,
        message: `literal values cannot fill field type ${fieldTypeName} — use a taskOutput value source instead`,
      },
    ];
  }
  if (fieldTypeName !== typeof value) {
    return [
      {
        path,
        message: `literal ${JSON.stringify(value)} (${typeof value}) does not match field type ${fieldTypeName}`,
      },
    ];
  }
  return [];
}

function validateGateSpec(
  gate: GateSpec,
  taskIds: Set<string>,
  stateTypes: Map<string, FieldType>,
  path: string
): SpecError[] {
  const errors: SpecError[] = [];
  const error = (p: string, message: string) =>
    errors.push({ path: p, message });

  switch (gate.kind) {
    case "always":
    case "never":
    case "hasRunningTask":
    case "noRunningTask":
      break;
    case "taskSuccess":
    case "taskError":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      break;
    case "taskOutputEquals":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      if (
        typeof gate.path !== "string" ||
        !(gate.path === "output" || gate.path.startsWith("output."))
      ) {
        error(
          path,
          `taskOutputEquals path must be "output" or "output.<segment>..." (got ${JSON.stringify(gate.path)})`
        );
      }
      break;
    case "instanceStateEquals": {
      const type = stateTypes.get(gate.field);
      if (type === undefined) {
        error(
          path,
          `gate reads instance-state field "${gate.field}" which is not declared (declared: ${[...stateTypes.keys()].join(", ")})`
        );
      } else if (type.endsWith("[]") || type === "object") {
        error(
          path,
          `gate compares instance-state field "${gate.field}" (type ${type}) with a scalar — use taskOutputEquals or a patch op instead`
        );
      } else if (type !== typeof gate.value) {
        error(
          path,
          `gate compares instance-state field "${gate.field}" (type ${type}) with a ${typeof gate.value} value`
        );
      }
      break;
    }
    case "errorCountAtLeast":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      break;
    case "not":
      for (const e of validateGateSpec(
        gate.gate,
        taskIds,
        stateTypes,
        `${path}.gate`
      )) {
        errors.push(e);
      }
      break;
    case "and":
    case "or":
      if (!Array.isArray(gate.gates) || gate.gates.length === 0) {
        error(path, `${gate.kind} requires a non-empty gates array`);
      } else {
        gate.gates.forEach((g, i) => {
          for (const e of validateGateSpec(
            g,
            taskIds,
            stateTypes,
            `${path}.gates[${i}]`
          )) {
            errors.push(e);
          }
        });
      }
      break;
    default: {
      const exhaustive: never = gate;
      error(path, `unknown gate kind ${JSON.stringify(exhaustive)}`);
    }
  }
  return errors;
}

function collectGateStateReads(gate: GateSpec, reads: Set<string>): void {
  switch (gate.kind) {
    case "instanceStateEquals":
      reads.add(gate.field);
      break;
    case "not":
      collectGateStateReads(gate.gate, reads);
      break;
    case "and":
    case "or":
      for (const g of gate.gates) collectGateStateReads(g, reads);
      break;
    default:
      break;
  }
}

function validateCreateInstance(
  create: { workflowId: string; fields: ConfigField[] },
  workflowById: Map<string, WorkflowSpec>,
  instanceStateById: Map<string, Map<string, FieldType>>,
  path: string
): SpecError[] {
  const errors: SpecError[] = [];
  const target = workflowById.get(create.workflowId);
  if (!target) {
    errors.push({
      path,
      message: `createInstance targets unknown workflow ${JSON.stringify(create.workflowId)} (workflows: ${[...workflowById.keys()].join(", ")})`,
    });
    return errors;
  }
  const types = instanceStateById.get(target.id);
  if (!types) return errors;
  for (const field of create.fields) {
    if (!types.has(field.key)) {
      errors.push({
        path,
        message: `createInstance field "${field.key}" is not declared in workflow "${target.id}" instanceState (declared: ${[...types.keys()].join(", ")})`,
      });
    }
  }
  return errors;
}
