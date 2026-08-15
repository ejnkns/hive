/** @private — the definition parser: a definition module (the pure-data TS
 * literal) → the data FlowDefinition object. Relocated from the reverse
 * renderer's literal readers: the definition declares its vocabulary directly
 * (instanceState fields, structured gates/values, patch/completionOutput/
 * extract task fields), so the parse is a plain literal read — no anchors, no
 * type aliases, no generated machinery to reverse.
 *
 * The parser is the editor's binding seam (the Definition tab binds to the
 * parsed object, so a structured-form panel can later replace the raw
 * literal without re-plumbing) and the validation-from-source surface. The
 * loader imports the module for the canonical object; this parse reads the
 * same shape from source without executing it. A hand-written shape the
 * definition cannot express (a closure gate, an unknown property) surfaces as
 * a location-named finding; the representable rest is still recovered. */

import ts from "typescript";
import type {
  ActionSpec,
  AutoTransitionSpec,
  CompletionOutputField,
  EdgeSpec,
  FanOutValueSpec,
  FieldType,
  FlowDefinition,
  FlowLevelActionSpec,
  GateSpec,
  OperationRefSpec,
  StateSpec,
  TaskSpec,
  ToolRefSpec,
  ValueSpec,
  WorkflowSpec,
} from "workflow-engine/workflow-types";
import { unwrap } from "../schema-consistency.ts";
import {
  type DisplayFieldRead,
  findFlowLiteral,
  literalJson,
  literalScalar,
  parseEntrySource,
  property,
  propertyNames,
  readArray,
  readBoardColumns,
  readBool,
  readConfigFields,
  readDisplayFields,
  readInstanceState,
  readNumber,
  readObject,
  readString,
  readStringArray,
} from "./read.ts";

export type ParseResult = {
  definition: FlowDefinition;
  // Location-named findings: hand-written shapes the data definition cannot
  // carry (a closure gate, an unknown property, a non-literal value).
  findings: string[];
};

export function parseDefinition(source: string): ParseResult {
  const findings: string[] = [];
  const sourceFile = parseEntrySource(source);
  const flowLiteral = findFlowLiteral(sourceFile);
  if (flowLiteral === undefined) {
    findings.push(
      "flow: no `export const flow: FlowDefinition = { ... }` literal found — this source is not a definition module"
    );
    return {
      definition: {
        id: "",
        label: "",
        configSchema: [],
        workflows: [],
      },
      findings,
    };
  }
  const definition = parseFlow(flowLiteral, findings);
  return { definition, findings };
}

// ─── flow level ──────────────────────────────────────────────────────

const FLOW_KEYS = [
  "id",
  "label",
  "description",
  "configSchema",
  "domainDir",
  "ui",
  "tools",
  "operations",
  "dependencies",
  "workflows",
  "edges",
  "actions",
] as const;

function parseFlow(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): FlowDefinition {
  checkKeys(flowLiteral, FLOW_KEYS, "flow", findings);

  const definition: FlowDefinition = {
    id: requiredString(flowLiteral, "id", "flow", findings),
    label: requiredString(flowLiteral, "label", "flow", findings),
    configSchema: readConfigFields(
      readArray(flowLiteral, "configSchema"),
      "configSchema",
      findings
    ),
    workflows: [],
  };
  const description = readString(flowLiteral, "description");
  if (description !== undefined) definition.description = description;
  const domainDir = readString(flowLiteral, "domainDir");
  if (domainDir !== undefined) definition.domainDir = domainDir;

  // Flow-level ui declarations: view, kinds (custom render kinds), and the
  // served component modules (id → source string, read directly).
  const flowUi = readObject(flowLiteral, "ui");
  if (flowUi !== undefined) {
    const ui: NonNullable<FlowDefinition["ui"]> = {};
    const view = readString(flowUi, "view");
    if (view !== undefined) ui.view = view as NonNullable<typeof ui.view>;
    const kinds = readArray(flowUi, "kinds");
    if (kinds !== undefined) {
      const parsedKinds = kinds
        .map((element) => literalJson(element))
        .filter(
          (kind): kind is { kind: string; contract: unknown } =>
            typeof kind === "object" &&
            kind !== null &&
            typeof (kind as { kind?: unknown }).kind === "string" &&
            (kind as { contract?: unknown }).contract !== undefined
        );
      if (parsedKinds.length > 0) {
        ui.kinds = parsedKinds as NonNullable<typeof ui.kinds>;
      }
    }
    const componentsLiteral = readObject(flowUi, "components");
    if (componentsLiteral !== undefined) {
      const components: Record<string, string> = {};
      for (const prop of componentsLiteral.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const id = ts.isStringLiteral(prop.name)
          ? prop.name.text
          : ts.isIdentifier(prop.name)
            ? prop.name.text
            : undefined;
        const value = unwrap(prop.initializer);
        const source = ts.isStringLiteral(value) ? value.text : undefined;
        if (id === undefined || source === undefined) {
          findings.push(
            "flow.ui.components: not data — a served component must map an id to a source string"
          );
          continue;
        }
        components[id] = source;
      }
      if (Object.keys(components).length > 0) ui.components = components;
    }
    if (Object.keys(ui).length > 0) definition.ui = ui;
  }

  const tools = readToolRefs(flowLiteral, findings);
  if (tools.length > 0) definition.tools = tools;
  const operations = readOperationRefs(flowLiteral, findings);
  if (operations.length > 0) definition.operations = operations;
  const dependencies = readStringArray(flowLiteral, "dependencies");
  if (dependencies !== undefined && dependencies.length > 0) {
    definition.dependencies = dependencies;
  }

  definition.workflows = readWorkflows(flowLiteral, findings);
  const edges = readEdges(flowLiteral, findings);
  if (edges.length > 0) definition.edges = edges;
  const actions = readFlowLevelActions(flowLiteral, findings);
  if (actions.length > 0) definition.actions = actions;
  return definition;
}

// ─── workflows ───────────────────────────────────────────────────────

const WORKFLOW_KEYS = [
  "id",
  "label",
  "description",
  "instance",
  "ui",
  "display",
  "editFields",
  "instanceState",
  "initial",
  "terminalStates",
  "states",
] as const;

function readWorkflows(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): WorkflowSpec[] {
  const workflows: WorkflowSpec[] = [];
  (readArray(flowLiteral, "workflows") ?? []).forEach((element, wfIndex) => {
    const wfPath = `workflows[${wfIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(
        `${wfPath}: not data — a workflow must be an object literal`
      );
      return;
    }
    checkKeys(obj, WORKFLOW_KEYS, wfPath, findings);
    const workflow: WorkflowSpec = {
      id: requiredString(obj, "id", wfPath, findings),
      label: requiredString(obj, "label", wfPath, findings),
      instanceState: readInstanceState(
        readArray(obj, "instanceState"),
        `${wfPath}.instanceState`,
        findings
      ) as WorkflowSpec["instanceState"],
      initial: requiredString(obj, "initial", wfPath, findings),
      terminalStates: readStringArray(obj, "terminalStates") ?? [],
      states: readStates(obj, wfPath, findings),
    };
    const description = readString(obj, "description");
    if (description !== undefined) workflow.description = description;
    const instance = readObject(obj, "instance");
    if (instance !== undefined) {
      const title = readString(instance, "title");
      const subtitle = readString(instance, "subtitle");
      if (title !== undefined) {
        workflow.instance = { title };
        if (subtitle !== undefined) workflow.instance.subtitle = subtitle;
      } else {
        findings.push(
          `${wfPath}.instance: not data — instance must carry a title`
        );
      }
    }
    const ui = readObject(obj, "ui");
    if (ui !== undefined) {
      const workflowUi: NonNullable<WorkflowSpec["ui"]> = {};
      const view = readString(ui, "view");
      if (view !== undefined) workflowUi.view = view as typeof workflowUi.view;
      const instanceComponent = readString(ui, "instanceComponent");
      if (instanceComponent !== undefined)
        workflowUi.instanceComponent = instanceComponent;
      const columns = readBoardColumns(
        readArray(ui, "columns"),
        `${wfPath}.ui.columns`,
        findings
      );
      if (columns !== undefined) workflowUi.columns = columns;
      if (Object.keys(workflowUi).length > 0) workflow.ui = workflowUi;
    }
    const display = readObject(obj, "display");
    if (display !== undefined) {
      const fields = readDisplayFields(
        readArray(display, "fields"),
        `${wfPath}.display.fields`,
        findings
      );
      if (fields !== undefined && fields.length > 0) {
        workflow.display = { fields: fields.map(toDisplayField) };
      }
    }
    const editFields = readConfigFields(
      readArray(obj, "editFields"),
      `${wfPath}.editFields`,
      findings
    );
    if (editFields.length > 0) workflow.editFields = editFields;
    workflows.push(workflow);
  });
  return workflows;
}

function toDisplayField(
  field: DisplayFieldRead
): NonNullable<WorkflowSpec["display"]>["fields"][number] {
  return {
    path: field.path,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.render !== undefined
      ? {
          render: {
            kind: field.render.kind,
            ...(field.render.props !== undefined
              ? { props: field.render.props }
              : {}),
          },
        }
      : {}),
    ...(field.derive !== undefined ? { derive: field.derive } : {}),
  };
}

// ─── states ──────────────────────────────────────────────────────────

const STATE_KEYS = [
  "id",
  "label",
  "description",
  "category",
  "tasks",
  "autoTransitions",
  "actions",
] as const;

function readStates(
  wfLiteral: ts.ObjectLiteralExpression,
  wfPath: string,
  findings: string[]
): StateSpec[] {
  const states: StateSpec[] = [];
  (readArray(wfLiteral, "states") ?? []).forEach((element, sIndex) => {
    const sPath = `${wfPath}.states[${sIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(`${sPath}: not data — a state must be an object literal`);
      return;
    }
    checkKeys(obj, STATE_KEYS, sPath, findings);
    const state: StateSpec = {
      id: requiredString(obj, "id", sPath, findings),
      label: requiredString(obj, "label", sPath, findings),
    };
    const description = readString(obj, "description");
    if (description !== undefined) state.description = description;
    const category = readString(obj, "category");
    if (category !== undefined) {
      state.category = category as StateSpec["category"];
    }
    const tasks = readTasks(obj, sPath, findings);
    if (tasks.length > 0) state.tasks = tasks;
    const autoTransitions = readAutoTransitions(obj, sPath, findings);
    if (autoTransitions.length > 0) state.autoTransitions = autoTransitions;
    const actions = readStateActions(obj, sPath, findings);
    if (actions.length > 0) state.actions = actions;
    states.push(state);
  });
  return states;
}

// ─── tasks ───────────────────────────────────────────────────────────

const TASK_KEYS = [
  "id",
  "label",
  "role",
  "operations",
  "operationInputs",
  "tools",
  "completionTool",
  "completionSignal",
  "systemPrompt",
  "systemPromptRef",
  "startOnUserInput",
  "workspacePath",
  "inputFromInstanceState",
  "persist",
  "render",
  "patch",
  "completionOutput",
  "extract",
] as const;

function readTasks(
  stateObj: ts.ObjectLiteralExpression,
  sPath: string,
  findings: string[]
): TaskSpec[] {
  const tasks: TaskSpec[] = [];
  (readArray(stateObj, "tasks") ?? []).forEach((element, tIndex) => {
    const tPath = `${sPath}.tasks[${tIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(`${tPath}: not data — a task must be an object literal`);
      return;
    }
    checkKeys(obj, TASK_KEYS, tPath, findings);
    const id = requiredString(obj, "id", tPath, findings);
    const role = readString(obj, "role");
    if (role !== "operation" && role !== "ai-task" && role !== "ai-chat") {
      findings.push(
        `${tPath}.role: not data — role must be operation, ai-task, or ai-chat`
      );
      return;
    }
    const task: TaskSpec = {
      id,
      role,
    };
    const label = readString(obj, "label");
    if (label !== undefined) task.label = label;

    const operations = readOperations(obj, tPath, findings);
    if (operations.length > 0) task.operations = operations;
    const operationInputs = readObject(obj, "operationInputs");
    if (operationInputs !== undefined) {
      task.operationInputs = literalJson(operationInputs) as Record<
        string,
        unknown
      >;
    }
    const tools = readStringArray(obj, "tools");
    if (tools !== undefined && tools.length > 0) task.tools = tools;
    const completionTool = readString(obj, "completionTool");
    if (completionTool !== undefined) task.completionTool = completionTool;
    const completionSignal = readString(obj, "completionSignal");
    if (completionSignal !== undefined)
      task.completionSignal = completionSignal;
    const systemPrompt = readString(obj, "systemPrompt");
    if (systemPrompt !== undefined) task.systemPrompt = systemPrompt;
    const systemPromptRef = readString(obj, "systemPromptRef");
    if (systemPromptRef !== undefined) task.systemPromptRef = systemPromptRef;
    const startOnUserInput = readBool(obj, "startOnUserInput");
    if (startOnUserInput !== undefined)
      task.startOnUserInput = startOnUserInput;
    const workspacePath = readString(obj, "workspacePath");
    if (workspacePath !== undefined) task.workspacePath = workspacePath;
    const inputFromInstanceState = readString(obj, "inputFromInstanceState");
    if (inputFromInstanceState !== undefined) {
      task.inputFromInstanceState = inputFromInstanceState;
    }
    const persist = readObject(obj, "persist");
    if (persist !== undefined) {
      const persistPath = readString(persist, "path");
      if (persistPath !== undefined) task.persist = { path: persistPath };
      else
        findings.push(`${tPath}.persist: not data — persist must carry a path`);
    }
    const render = readObject(obj, "render");
    if (render !== undefined) {
      const kind = readString(render, "kind");
      if (kind !== undefined) {
        const renderHint: { kind: string; props?: Record<string, string> } = {
          kind,
        };
        const props = readObject(render, "props");
        if (props !== undefined) {
          renderHint.props = literalJson(props) as Record<string, string>;
        }
        task.render = renderHint;
      } else {
        findings.push(
          `${tPath}.render: not data — a render hint must carry a kind`
        );
      }
    }
    const patch = readObject(obj, "patch");
    if (patch !== undefined) {
      const parsedPatch: Record<string, ValueSpec> = {};
      for (const prop of patch.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const field = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;
        if (field === undefined) continue;
        const value = parseValueSpec(prop.initializer);
        if (value === undefined) {
          findings.push(
            `${tPath}.patch.${field}: not data — a patch value must be a value spec`
          );
          continue;
        }
        parsedPatch[field] = value;
      }
      if (Object.keys(parsedPatch).length > 0) task.patch = parsedPatch;
    }
    const completionOutput = readArray(obj, "completionOutput");
    if (completionOutput !== undefined) {
      const fields = completionOutput
        .map((element) => {
          const raw = literalJson(element);
          if (
            typeof raw !== "object" ||
            raw === null ||
            typeof (raw as { field?: unknown }).field !== "string" ||
            typeof (raw as { type?: unknown }).type !== "string"
          ) {
            findings.push(
              `${tPath}.completionOutput: not data — a completion field must carry field and type`
            );
            return undefined;
          }
          return raw as CompletionOutputField;
        })
        .filter((field): field is CompletionOutputField => field !== undefined);
      if (fields.length > 0) task.completionOutput = fields;
    }
    const extract = readObject(obj, "extract");
    if (extract !== undefined) {
      const ref = readString(extract, "ref");
      const fields = readStringArray(extract, "fields");
      if (ref !== undefined && fields !== undefined) {
        task.extract = { ref, fields };
      } else {
        findings.push(
          `${tPath}.extract: not data — extract must carry ref and fields`
        );
      }
    }
    tasks.push(task);
  });
  return tasks;
}

// A task's operations: engine names, flow-level op ids, or inline references
// to a custom operation module (`{ ref: "./ops/x.ts" }`).
function readOperations(
  obj: ts.ObjectLiteralExpression,
  tPath: string,
  findings: string[]
): (string | { ref: string })[] {
  const operations: (string | { ref: string })[] = [];
  (readArray(obj, "operations") ?? []).forEach((element, index) => {
    const value = unwrap(element);
    if (ts.isStringLiteral(value)) {
      operations.push(value.text);
      return;
    }
    if (ts.isObjectLiteralExpression(value)) {
      const ref = readString(value, "ref");
      if (ref !== undefined) {
        operations.push({ ref });
        return;
      }
    }
    findings.push(
      `${tPath}.operations[${index}]: not data — an operation must be a name or a { ref } object`
    );
  });
  return operations;
}

// ─── gates and value specs (data literals) ───────────────────────────

export function parseGateSpec(
  expr: ts.Expression,
  path: string,
  findings: string[]
): GateSpec | undefined {
  const raw = literalJson(expr);
  const gate = asRecord(raw);
  if (gate === undefined || typeof gate.kind !== "string") {
    findings.push(`${path}: not data — a gate must be a { kind, ... } object`);
    return undefined;
  }
  switch (gate.kind) {
    case "always":
    case "never":
    case "hasRunningTask":
    case "noRunningTask":
      return { kind: gate.kind };
    case "taskSuccess":
    case "taskError":
      if (typeof gate.task === "string") {
        return { kind: gate.kind, task: gate.task };
      }
      break;
    case "taskOutputEquals":
      if (
        typeof gate.task === "string" &&
        typeof gate.path === "string" &&
        isScalar(gate.value)
      ) {
        return {
          kind: "taskOutputEquals",
          task: gate.task,
          path: gate.path,
          value: gate.value,
        };
      }
      break;
    case "instanceStateEquals":
      if (typeof gate.field === "string" && isScalar(gate.value)) {
        return {
          kind: "instanceStateEquals",
          field: gate.field,
          value: gate.value,
        };
      }
      break;
    case "errorCountAtLeast":
      if (typeof gate.task === "string" && typeof gate.count === "number") {
        return {
          kind: "errorCountAtLeast",
          task: gate.task,
          count: gate.count,
        };
      }
      break;
    case "file":
      if (typeof gate.ref === "string") return { kind: "file", ref: gate.ref };
      break;
    case "not": {
      const inner = parseGateSpecRaw(gate.gate, `${path}.gate`, findings);
      if (inner !== undefined) return { kind: "not", gate: inner };
      break;
    }
    case "and":
    case "or": {
      if (Array.isArray(gate.gates)) {
        const gates: GateSpec[] = [];
        for (const [i, g] of gate.gates.entries()) {
          const inner = parseGateSpecRaw(g, `${path}.gates[${i}]`, findings);
          if (inner === undefined) return undefined;
          gates.push(inner);
        }
        return { kind: gate.kind, gates };
      }
      break;
    }
  }
  findings.push(`${path}: not data — unrecognized gate shape`);
  return undefined;
}

// The recursive gate reader over an already-JSON-parsed value (nested in
// not/and/or the property is a literal, not a TS expression).
function parseGateSpecRaw(
  raw: unknown,
  path: string,
  findings: string[]
): GateSpec | undefined {
  const gate = asRecord(raw);
  if (gate === undefined || typeof gate.kind !== "string") return undefined;
  switch (gate.kind) {
    case "always":
    case "never":
    case "hasRunningTask":
    case "noRunningTask":
      return { kind: gate.kind };
    case "taskSuccess":
    case "taskError":
      return typeof gate.task === "string"
        ? { kind: gate.kind, task: gate.task }
        : undefined;
    case "taskOutputEquals":
      return typeof gate.task === "string" &&
        typeof gate.path === "string" &&
        isScalar(gate.value)
        ? {
            kind: "taskOutputEquals",
            task: gate.task,
            path: gate.path,
            value: gate.value,
          }
        : undefined;
    case "instanceStateEquals":
      return typeof gate.field === "string" && isScalar(gate.value)
        ? { kind: "instanceStateEquals", field: gate.field, value: gate.value }
        : undefined;
    case "errorCountAtLeast":
      return typeof gate.task === "string" && typeof gate.count === "number"
        ? { kind: "errorCountAtLeast", task: gate.task, count: gate.count }
        : undefined;
    case "file":
      return typeof gate.ref === "string"
        ? { kind: "file", ref: gate.ref }
        : undefined;
    case "not": {
      const inner = parseGateSpecRaw(gate.gate, `${path}.gate`, findings);
      return inner !== undefined ? { kind: "not", gate: inner } : undefined;
    }
    case "and":
    case "or": {
      if (!Array.isArray(gate.gates)) return undefined;
      const gates: GateSpec[] = [];
      for (const [i, g] of gate.gates.entries()) {
        const inner = parseGateSpecRaw(g, `${path}.gates[${i}]`, findings);
        if (inner === undefined) return undefined;
        gates.push(inner);
      }
      return { kind: gate.kind, gates };
    }
    default:
      return undefined;
  }
}

function parseValueSpec(expr: ts.Expression): ValueSpec | undefined {
  const raw = literalJson(expr);
  const value = asRecord(raw);
  if (value === undefined || typeof value.kind !== "string") return undefined;
  switch (value.kind) {
    case "literal":
      return isScalar(value.value)
        ? { kind: "literal", value: value.value }
        : undefined;
    case "taskOutput":
      return typeof value.task === "string" && typeof value.path === "string"
        ? { kind: "taskOutput", task: value.task, path: value.path }
        : undefined;
    case "instanceId":
      return { kind: "instanceId" };
    default:
      return undefined;
  }
}

function parseFanOutValueSpec(
  expr: ts.Expression
): FanOutValueSpec | undefined {
  const raw = literalJson(expr);
  const value = asRecord(raw);
  if (value === undefined || typeof value.kind !== "string") return undefined;
  switch (value.kind) {
    case "literal":
      return isScalar(value.value)
        ? { kind: "literal", value: value.value }
        : undefined;
    case "itemPath":
      return typeof value.path === "string"
        ? { kind: "itemPath", path: value.path }
        : undefined;
    case "instanceId":
      return { kind: "instanceId" };
    default:
      return undefined;
  }
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ─── auto transitions / actions ──────────────────────────────────────

function readAutoTransitions(
  stateObj: ts.ObjectLiteralExpression,
  sPath: string,
  findings: string[]
): AutoTransitionSpec[] {
  const transitions: AutoTransitionSpec[] = [];
  (readArray(stateObj, "autoTransitions") ?? []).forEach((element, tIndex) => {
    const tPath = `${sPath}.autoTransitions[${tIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(
        `${tPath}: not data — an auto transition must be an object literal`
      );
      return;
    }
    const to = readString(obj, "to");
    const gateProp = property(obj, "gate");
    if (to === undefined || gateProp === undefined) {
      findings.push(
        `${tPath}: not data — an auto transition must carry to and gate`
      );
      return;
    }
    const gate = parseGateSpec(gateProp.initializer, `${tPath}.gate`, findings);
    if (gate === undefined) return;
    transitions.push({ to, gate });
  });
  return transitions;
}

const STATE_ACTION_KEYS = [
  "id",
  "label",
  "variant",
  "confirmText",
  "gate",
  "maxWorkflowInstancesInTarget",
  "dependsOnState",
  "newAttempt",
  "completesRunningTask",
  "createInstance",
  "fields",
  "transitionTo",
] as const;

function readStateActions(
  stateObj: ts.ObjectLiteralExpression,
  sPath: string,
  findings: string[]
): ActionSpec[] {
  const actions: ActionSpec[] = [];
  (readArray(stateObj, "actions") ?? []).forEach((element, aIndex) => {
    const aPath = `${sPath}.actions[${aIndex}]`;
    const action = readAction(element, aPath, STATE_ACTION_KEYS, findings);
    if (action !== undefined) actions.push(action);
  });
  return actions;
}

const FLOW_ACTION_KEYS = [
  "id",
  "label",
  "variant",
  "gate",
  "createInstance",
  "dispatchToAll",
] as const;

function readFlowLevelActions(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): FlowLevelActionSpec[] {
  const actions: FlowLevelActionSpec[] = [];
  (readArray(flowLiteral, "actions") ?? []).forEach((element, aIndex) => {
    const aPath = `actions[${aIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(
        `${aPath}: not data — a flow action must be an object literal`
      );
      return;
    }
    checkKeys(obj, FLOW_ACTION_KEYS, aPath, findings);
    const action: FlowLevelActionSpec = {
      id: requiredString(obj, "id", aPath, findings),
      label: requiredString(obj, "label", aPath, findings),
    };
    const variant = readString(obj, "variant");
    if (variant !== undefined)
      action.variant = variant as FlowLevelActionSpec["variant"];
    const gateProp = property(obj, "gate");
    if (gateProp !== undefined) {
      const gate = parseGateSpec(
        gateProp.initializer,
        `${aPath}.gate`,
        findings
      );
      if (gate !== undefined) action.gate = gate;
    }
    const createInstance = readCreateInstance(
      obj,
      `${aPath}.createInstance`,
      findings
    );
    if (createInstance !== undefined) action.createInstance = createInstance;
    const dispatchToAll = readObject(obj, "dispatchToAll");
    if (dispatchToAll !== undefined) {
      const workflowId = readString(dispatchToAll, "workflowId");
      const actionId = readString(dispatchToAll, "actionId");
      if (workflowId !== undefined && actionId !== undefined) {
        action.dispatchToAll = { workflowId, actionId };
      } else {
        findings.push(
          `${aPath}.dispatchToAll: not data — dispatchToAll must carry workflowId and actionId`
        );
      }
    }
    actions.push(action);
  });
  return actions;
}

function readAction(
  element: ts.Expression,
  aPath: string,
  keys: readonly string[],
  findings: string[]
): ActionSpec | undefined {
  const obj = unwrap(element);
  if (!ts.isObjectLiteralExpression(obj)) {
    findings.push(`${aPath}: not data — an action must be an object literal`);
    return undefined;
  }
  checkKeys(obj, keys, aPath, findings);
  const action: ActionSpec = {
    id: requiredString(obj, "id", aPath, findings),
    label: requiredString(obj, "label", aPath, findings),
  };
  const variant = readString(obj, "variant");
  if (variant !== undefined) action.variant = variant as ActionSpec["variant"];
  const confirmText = readString(obj, "confirmText");
  if (confirmText !== undefined) action.confirmText = confirmText;
  const gateProp = property(obj, "gate");
  if (gateProp !== undefined) {
    const gate = parseGateSpec(gateProp.initializer, `${aPath}.gate`, findings);
    if (gate !== undefined) action.gate = gate;
  }
  const max = readNumber(obj, "maxWorkflowInstancesInTarget");
  if (max !== undefined) action.maxWorkflowInstancesInTarget = max;
  const dependsOnState = readString(obj, "dependsOnState");
  if (dependsOnState !== undefined) action.dependsOnState = dependsOnState;
  const newAttempt = readBool(obj, "newAttempt");
  if (newAttempt !== undefined) action.newAttempt = newAttempt;
  const completesRunningTask = readBool(obj, "completesRunningTask");
  if (completesRunningTask !== undefined) {
    action.completesRunningTask = completesRunningTask;
  }
  const createInstance = readCreateInstance(
    obj,
    `${aPath}.createInstance`,
    findings
  );
  if (createInstance !== undefined) action.createInstance = createInstance;
  const fields = readConfigFields(
    readArray(obj, "fields"),
    `${aPath}.fields`,
    findings
  );
  if (fields.length > 0) action.fields = fields;
  const transitionTo = readString(obj, "transitionTo");
  if (transitionTo !== undefined) action.transitionTo = transitionTo;
  return action;
}

function readCreateInstance(
  obj: ts.ObjectLiteralExpression,
  path: string,
  findings: string[]
):
  | {
      workflowId: string;
      fields: NonNullable<ActionSpec["createInstance"]>["fields"];
    }
  | undefined {
  const create = readObject(obj, "createInstance");
  if (create === undefined) return undefined;
  const workflowId = readString(create, "workflowId");
  if (workflowId === undefined) {
    findings.push(`${path}: not data — createInstance must carry a workflowId`);
    return undefined;
  }
  return {
    workflowId,
    fields: readConfigFields(
      readArray(create, "fields"),
      `${path}.fields`,
      findings
    ),
  };
}

// ─── edges ───────────────────────────────────────────────────────────

const EDGE_KEYS = [
  "fromWorkflow",
  "fromStates",
  "toWorkflow",
  "fields",
  "fanOut",
  "transform",
] as const;

function readEdges(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): EdgeSpec[] {
  const edges: EdgeSpec[] = [];
  (readArray(flowLiteral, "edges") ?? []).forEach((element, eIndex) => {
    const ePath = `edges[${eIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(`${ePath}: not data — an edge must be an object literal`);
      return;
    }
    checkKeys(obj, EDGE_KEYS, ePath, findings);
    const edge: EdgeSpec = {
      fromWorkflow: requiredString(obj, "fromWorkflow", ePath, findings),
      fromStates: readStringArray(obj, "fromStates") ?? [],
      toWorkflow: requiredString(obj, "toWorkflow", ePath, findings),
    };
    const fields = readObject(obj, "fields");
    if (fields !== undefined) {
      const parsed: Record<string, ValueSpec> = {};
      for (const prop of fields.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const field = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;
        if (field === undefined) continue;
        const value = parseValueSpec(prop.initializer);
        if (value === undefined) {
          findings.push(
            `${ePath}.fields.${field}: not data — an edge field value must be a value spec`
          );
          continue;
        }
        parsed[field] = value;
      }
      if (Object.keys(parsed).length > 0) edge.fields = parsed;
    }
    const fanOut = readObject(obj, "fanOut");
    if (fanOut !== undefined) {
      const task = readString(fanOut, "task");
      const path = readString(fanOut, "path");
      const fanFields = readObject(fanOut, "fields");
      if (task === undefined || path === undefined || fanFields === undefined) {
        findings.push(
          `${ePath}.fanOut: not data — fanOut must carry task, path, and fields`
        );
      } else {
        const parsed: Record<string, FanOutValueSpec> = {};
        for (const prop of fanFields.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const field = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : undefined;
          if (field === undefined) continue;
          const value = parseFanOutValueSpec(prop.initializer);
          if (value === undefined) {
            findings.push(
              `${ePath}.fanOut.fields.${field}: not data — a fan-out value must be a fan-out value spec`
            );
            continue;
          }
          parsed[field] = value;
        }
        edge.fanOut = { task, path, fields: parsed };
      }
    }
    const transform = readObject(obj, "transform");
    if (transform !== undefined) {
      const ref = readString(transform, "ref");
      const transformFields = readStringArray(transform, "fields");
      if (ref !== undefined && transformFields !== undefined) {
        edge.transform = { ref, fields: transformFields };
      } else {
        findings.push(
          `${ePath}.transform: not data — transform must carry ref and fields`
        );
      }
    }
    edges.push(edge);
  });
  return edges;
}

// ─── flow-level capability refs ──────────────────────────────────────

function readToolRefs(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): ToolRefSpec[] {
  const tools: ToolRefSpec[] = [];
  (readArray(flowLiteral, "tools") ?? []).forEach((element, index) => {
    const tPath = `tools[${index}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(
        `${tPath}: not data — a tool ref must be an object literal`
      );
      return;
    }
    const id = readString(obj, "id");
    const ref = readString(obj, "ref");
    if (id === undefined || ref === undefined) {
      findings.push(`${tPath}: not data — a tool ref must carry id and ref`);
      return;
    }
    const tool: ToolRefSpec = { id, ref };
    const writes = readStringArray(obj, "writes");
    if (writes !== undefined && writes.length > 0) tool.writes = writes;
    tools.push(tool);
  });
  return tools;
}

function readOperationRefs(
  flowLiteral: ts.ObjectLiteralExpression,
  findings: string[]
): OperationRefSpec[] {
  const operations: OperationRefSpec[] = [];
  (readArray(flowLiteral, "operations") ?? []).forEach((element, index) => {
    const oPath = `operations[${index}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      findings.push(
        `${oPath}: not data — an operation ref must be an object literal`
      );
      return;
    }
    const id = readString(obj, "id");
    const ref = readString(obj, "ref");
    if (id === undefined || ref === undefined) {
      findings.push(
        `${oPath}: not data — an operation ref must carry id and ref`
      );
      return;
    }
    const operation: OperationRefSpec = { id, ref };
    const writes = readStringArray(obj, "writes");
    if (writes !== undefined && writes.length > 0) operation.writes = writes;
    operations.push(operation);
  });
  return operations;
}

// ─── helpers ─────────────────────────────────────────────────────────

function checkKeys(
  obj: ts.ObjectLiteralExpression,
  known: readonly string[],
  path: string,
  findings: string[]
): void {
  for (const name of propertyNames(obj)) {
    if (!known.includes(name)) {
      findings.push(
        `${path}: not data — the "${name}" property is not part of the definition vocabulary`
      );
    }
  }
}

function requiredString(
  obj: ts.ObjectLiteralExpression,
  key: string,
  path: string,
  findings: string[]
): string {
  const value = readString(obj, key);
  if (value === undefined) {
    findings.push(`${path}: missing required "${key}"`);
    return "";
  }
  return value;
}
