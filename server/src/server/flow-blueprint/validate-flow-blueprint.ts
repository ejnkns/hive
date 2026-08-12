/** @private — the blueprint validator: walks flows/workflows, then delegates the
 * edge and writer-invariant sections. */

import {
  DOTTED_PATH,
  engineOpNames,
  FIELD_TYPES,
  IDENTIFIER,
  infraToolNames,
} from "./blueprint-constants.ts";
import type {
  BlueprintError,
  BlueprintValidationContext,
  CompletionOutputField,
  FieldType,
  FlowBlueprint,
  GateSpec,
  WorkflowSpec,
} from "./blueprint-types.ts";
import { validateEdges } from "./validate-edges.ts";
import {
  isConfigField,
  isDerivedDisplay,
  isFieldType,
} from "./validate-fields.ts";
import { collectGateTaskReads, validateGateSpec } from "./validate-gate.ts";
import { validateRefShape } from "./validate-ref.ts";
import {
  checkLiteralMatches,
  validateCreateInstance,
  validateValueSpec,
} from "./validate-values.ts";
import { validateWriters } from "./validate-writers.ts";

export function validateFlowBlueprint(
  blueprint: FlowBlueprint
): BlueprintError[] {
  const errors: BlueprintError[] = [];
  const error = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  // ── flow level ──
  if (typeof blueprint.id !== "string" || !IDENTIFIER.test(blueprint.id)) {
    error(
      "id",
      `flow id must be a valid identifier (got ${JSON.stringify(blueprint.id)})`
    );
  }
  if (typeof blueprint.label !== "string" || blueprint.label.trim() === "") {
    error("label", "flow label is required");
  }
  if (!Array.isArray(blueprint.workflows) || blueprint.workflows.length === 0) {
    error("workflows", "a flow needs at least one workflow");
  }
  if (!Array.isArray(blueprint.configSchema)) {
    error("configSchema", "configSchema must be an array");
  } else {
    blueprint.configSchema.forEach((field, i) => {
      if (!isConfigField(field)) {
        error(
          `configSchema[${i}]`,
          `invalid config field: ${JSON.stringify(field)}`
        );
      }
    });
  }

  // ── blueprint-referenced modules ──
  // Custom tools and operations the flow ships as referenced files. Tasks
  // reference tools by id and operations by id (alongside engine ops).
  const toolIds = new Set<string>();
  for (const [tIndex, tool] of (blueprint.tools ?? []).entries()) {
    const tPath = `tools[${tIndex}]`;
    if (typeof tool.id !== "string" || !IDENTIFIER.test(tool.id)) {
      error(
        `${tPath}.id`,
        `tool id must be a valid identifier (got ${JSON.stringify(tool.id)})`
      );
    }
    if (toolIds.has(tool.id)) {
      error(`${tPath}.id`, `duplicate tool id "${tool.id}"`);
    }
    toolIds.add(tool.id);
    for (const e of validateRefShape(tool.ref, `${tPath}.ref`)) {
      error(e.path, e.message);
    }
  }
  const operationIds = new Set<string>();
  for (const [oIndex, op] of (blueprint.operations ?? []).entries()) {
    const oPath = `operations[${oIndex}]`;
    if (typeof op.id !== "string" || !IDENTIFIER.test(op.id)) {
      error(
        `${oPath}.id`,
        `operation id must be a valid identifier (got ${JSON.stringify(op.id)})`
      );
    }
    if (operationIds.has(op.id)) {
      error(`${oPath}.id`, `duplicate operation id "${op.id}"`);
    }
    operationIds.add(op.id);
    for (const e of validateRefShape(op.ref, `${oPath}.ref`)) {
      error(e.path, e.message);
    }
  }

  const workflowById = new Map<string, WorkflowSpec>();
  const stateIdsByWorkflow = new Map<string, Set<string>>();
  const taskIdsByWorkflow = new Map<string, Set<string>>();
  const instanceStateById = new Map<string, Map<string, FieldType>>();
  // Per-workflow: task id → declared structured completion fields. Used to
  // check that taskOutput reads (patch/edge values, taskOutputEquals gates)
  // resolve to fields the source task actually returns.
  const completionOutputById = new Map<
    string,
    Map<string, CompletionOutputField[]>
  >();

  // ── workflows ──
  for (const [wfIndex, wf] of blueprint.workflows.entries()) {
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
    const completionOutputs = new Map<string, CompletionOutputField[]>();
    completionOutputById.set(wf.id, completionOutputs);

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
        if (task.completionOutput !== undefined) {
          if (task.role !== "ai-task") {
            error(
              `${tPath}.completionOutput`,
              `completionOutput declares a structured completion contract and requires an ai-task role; ${task.id} is ${task.role}`
            );
          }
          if (task.completionTool !== undefined) {
            error(
              `${tPath}.completionOutput`,
              `completionOutput generates the task's completion tool; do not also set completionTool (${task.id} declares both)`
            );
          }
          const seen = new Set<string>();
          task.completionOutput.forEach((field, i) => {
            if (!field || !IDENTIFIER.test(field.field)) {
              error(
                `${tPath}.completionOutput[${i}]`,
                `completionOutput field name must be a valid identifier (got ${JSON.stringify(field?.field)})`
              );
              return;
            }
            if (!isFieldType(field.type)) {
              error(
                `${tPath}.completionOutput[${i}].type`,
                `invalid completionOutput field type ${JSON.stringify(field.type)} (valid: ${Object.keys(FIELD_TYPES).join(", ")})`
              );
              return;
            }
            if (seen.has(field.field)) {
              error(
                `${tPath}.completionOutput[${i}]`,
                `duplicate completionOutput field "${field.field}"`
              );
            }
            seen.add(field.field);
          });
          if (completionOutputs.has(task.id)) {
            error(
              `${tPath}.completionOutput`,
              `duplicate completionOutput on task "${task.id}"`
            );
          }
          completionOutputs.set(task.id, task.completionOutput);
        }
        if (task.extract !== undefined) {
          if (task.role !== "operation") {
            error(
              `${tPath}.extract`,
              `extract requires an operation task (it runs as a generated op that patches instance state); ${task.id} is ${task.role}`
            );
          }
          if (
            !Array.isArray(task.extract.fields) ||
            task.extract.fields.length === 0
          ) {
            error(
              `${tPath}.extract.fields`,
              `extract must declare the instance-state fields it produces (got ${JSON.stringify(task.extract.fields)})`
            );
          }
          for (const e of validateRefShape(
            task.extract.ref,
            `${tPath}.extract.ref`
          )) {
            error(e.path, e.message);
          }
          for (const field of task.extract.fields ?? []) {
            if (!stateTypes.has(field)) {
              error(
                `${tPath}.extract.fields`,
                `extract writes "${field}" which is not declared in instanceState`
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
          if (typeof op === "string") {
            if (!engineOpNames.has(op) && !operationIds.has(op)) {
              error(
                `${tPath}.operations`,
                `unknown operation "${op}" (engine ops and flow-level operation ids: ${[
                  ...engineOpNames,
                  ...operationIds,
                ]
                  .sort()
                  .join(", ")})`
              );
            }
          } else {
            for (const e of validateRefShape(
              op.ref,
              `${tPath}.operations.ref`
            )) {
              error(e.path, e.message);
            }
          }
        }
        for (const tool of task.tools ?? []) {
          if (!infraToolNames.has(tool) && !toolIds.has(tool)) {
            error(
              `${tPath}.tools`,
              `unknown tool "${tool}" (available: ${[
                ...infraToolNames,
                ...toolIds,
              ]
                .sort()
                .join(", ")})`
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
            `${tPath}.patch.${field}`,
            completionOutputs
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
        if (
          action.confirmText !== undefined &&
          typeof action.confirmText !== "string"
        ) {
          error(
            `${aPath}.confirmText`,
            `confirmText must be a string (got ${JSON.stringify(action.confirmText)})`
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
        if (action.fields !== undefined) {
          if (action.fields.length === 0) {
            error(
              `${aPath}.fields`,
              `fields must be empty or omitted — an action with no input fields needs no declaration`
            );
          }
          action.fields.forEach((field, i) => {
            if (!isConfigField(field)) {
              error(
                `${aPath}.fields[${i}]`,
                `invalid config field: ${JSON.stringify(field)}`
              );
              return;
            }
            if (!stateTypes.has(field.key)) {
              error(
                `${aPath}.fields[${i}].key`,
                `action field "${field.key}" writes instance state that is not declared in instanceState (declared: ${[...stateTypes.keys()].join(", ")})`
              );
            }
          });
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
      if (field.derive !== undefined && !isDerivedDisplay(field.derive)) {
        error(
          `${wfPath}.display.fields[${dIndex}].derive`,
          `invalid derive: ${JSON.stringify(field.derive)} (count/progress take a where clause with a string field and scalar equals — progress requires one; sum takes an optional string item field; countAcross/progressAcross aggregate instances by a scalar equals — progressAcross requires one)`
        );
      }
      if (
        field.derive !== undefined &&
        (field.derive.kind === "countAcross" ||
          field.derive.kind === "progressAcross") &&
        field.path.includes(".")
      ) {
        error(
          `${wfPath}.display.fields[${dIndex}].derive`,
          `across-instance derives require a single-segment path (got "${field.path}") — the summary aggregates top-level instance-state fields`
        );
      }
    }

    // editFields: the curated editable subset — every key must be declared in
    // instanceState and each entry a valid ConfigField. A non-empty array is
    // required when declared (an empty declaration is a no-op).
    if (wf.editFields !== undefined) {
      if (wf.editFields.length === 0) {
        error(
          `${wfPath}.editFields`,
          "editFields must be empty or omitted — a workflow with nothing editable needs no declaration"
        );
      }
      wf.editFields.forEach((field, i) => {
        if (!isConfigField(field)) {
          error(
            `${wfPath}.editFields[${i}]`,
            `invalid config field: ${JSON.stringify(field)}`
          );
          return;
        }
        if (!stateTypes.has(field.key)) {
          error(
            `${wfPath}.editFields[${i}].key`,
            `edit field "${field.key}" is not declared in instanceState (declared: ${[...stateTypes.keys()].join(", ")})`
          );
        }
      });
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
          // A task with a structured completion contract returns exactly its
          // declared fields; gate reads must address one of them and match
          // its type.
          const fields = completionOutputs.get(gate.task);
          if (fields !== undefined) {
            const fieldName = gate.path.slice("output.".length).split(".")[0];
            const declared = fields.find((f) => f.field === fieldName);
            if (declared === undefined) {
              error(
                `${wfPath}`,
                `taskOutputEquals reads output field "${fieldName}" which task "${gate.task}" does not declare in completionOutput (declared: ${fields.map((f) => f.field).join(", ")})`
              );
            } else if (
              !declared.type.endsWith("[]") &&
              declared.type !== "object" &&
              declared.type !== typeof gate.value
            ) {
              error(
                `${wfPath}`,
                `taskOutputEquals compares completionOutput field "${fieldName}" (type ${declared.type}) with a ${typeof gate.value} value`
              );
            }
          }
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
  for (const [aIndex, action] of (blueprint.actions ?? []).entries()) {
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

  const context: BlueprintValidationContext = {
    workflowById,
    stateIdsByWorkflow,
    taskIdsByWorkflow,
    instanceStateById,
    completionOutputById,
  };
  validateEdges(blueprint, context, error);
  validateWriters(blueprint, context, error);

  return errors;
}
export function analyzeFlowBlueprint(blueprint: FlowBlueprint): string[] {
  const findings: string[] = [];

  // 1. A prompt-less ai-task/ai-chat has no instructions: the agent produces
  //    prose instead of completing, or the ai-task runner fails fast when
  //    there is also no input.
  for (const wf of blueprint.workflows) {
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        if (
          (task.role === "ai-task" || task.role === "ai-chat") &&
          (task.systemPrompt ?? "").trim() === ""
        ) {
          findings.push(
            `workflow "${wf.id}" task "${task.id}" has no systemPrompt — the agent has no instructions; declare one naming the job and the completion tool to call`
          );
        }
      }
    }
  }

  // 2. A completionOutput task whose output nobody reads records nothing: the
  //    structured fields are discarded.
  const readTaskIds = new Set<string>();
  for (const wf of blueprint.workflows) {
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const value of Object.values(task.patch ?? {})) {
          if (value.kind === "taskOutput") readTaskIds.add(value.task);
        }
        for (const transition of state.autoTransitions ?? []) {
          collectGateTaskReads(transition.gate, readTaskIds);
        }
        for (const action of state.actions ?? []) {
          if (action.gate) collectGateTaskReads(action.gate, readTaskIds);
        }
      }
    }
  }
  for (const edge of blueprint.edges ?? []) {
    for (const value of Object.values(edge.fields ?? {})) {
      if (value.kind === "taskOutput") readTaskIds.add(value.task);
    }
    if (edge.fanOut) readTaskIds.add(edge.fanOut.task);
  }
  for (const wf of blueprint.workflows) {
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        if (
          task.completionOutput !== undefined &&
          task.completionOutput.length > 0 &&
          !readTaskIds.has(task.id)
        ) {
          findings.push(
            `workflow "${wf.id}" task "${task.id}" declares completionOutput but nothing reads its output — record it with a sibling patch op or an edge, or drop the declaration`
          );
        }
      }
    }
  }

  // 3. A flow with no creation path anywhere can never run.
  const hasCreateInstance =
    (blueprint.actions ?? []).some((a) => a.createInstance !== undefined) ||
    blueprint.workflows.some((wf) =>
      wf.states.some((s) =>
        (s.actions ?? []).some((a) => a.createInstance !== undefined)
      )
    );
  if (!hasCreateInstance && (blueprint.edges ?? []).length === 0) {
    findings.push(
      "nothing ever creates an instance — add a flow-level or state-level createInstance action, or an edge feeding a workflow"
    );
  }

  return findings;
}
