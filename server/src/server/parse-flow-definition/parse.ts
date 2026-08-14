/** @private — the reverse-renderer orchestration: a rendered-shape definition
 * entry → FlowBlueprint, reversing the renderer's emission (flow-renderer.ts)
 * one pass per concern. Returns the blueprint plus not-spec-representable
 * findings; the recoverable rest of a hand-edited definition is always
 * recovered. */

import ts from "typescript";
import type {
  BuiltinRenderKind,
  WorkflowView,
} from "workflow-engine/workflow-types";
import {
  engineOpNames,
  infraToolNames,
} from "../flow-blueprint/blueprint-constants.ts";
import type {
  ActionSpec,
  CompletionOutputField,
  EdgeSpec,
  FlowBlueprint,
  FlowLevelActionSpec,
  GateSpec,
  InstanceStateField,
  OperationRefSpec,
  StateSpec,
  TaskSpec,
  ToolRefSpec,
  ValueSpec,
  WorkflowSpec,
} from "../flow-blueprint.ts";
import { unwrap } from "../schema-consistency.ts";
import { readCompletionTools } from "./completion.ts";
import type { ParseContext } from "./context.ts";
import { notSpecRepresentable, unreadable } from "./findings.ts";
import { parseGate } from "./gates.ts";
import {
  anchorTypeName,
  type DisplayFieldRead,
  findFlowLiteral,
  findModuleConst,
  instanceStateFromAlias,
  literalJson,
  parseEntrySource,
  property,
  propertyNames,
  readArray,
  readBoardColumns,
  readBool,
  readConfigFields,
  readDisplayFields,
  readIdentifierArray,
  readNumber,
  readObject,
  readString,
  readStringArray,
  workflowConfigLiteral,
} from "./read.ts";
import {
  buildBindingMap,
  expectedExportName,
  recoverOperationWrites,
  recoverToolWrites,
} from "./refs.ts";
import { parseEdgeTransform, parsePatchValue } from "./values.ts";

export type ParseResult = {
  blueprint: FlowBlueprint;
  // Not-spec-representable findings: hand-written shapes the renderer never
  // emits, each naming the location. Advisory and model-actionable.
  findings: string[];
};

type PatchOpSpec = { kind: "patch"; patch: Record<string, ValueSpec> };
type ExtractOpSpec = { kind: "extract"; fields: string[]; binding: string };
type WorkflowOpSpecs = Map<string, PatchOpSpec | ExtractOpSpec>;

export function parseFlowDefinition(
  entry: string,
  files?: Record<string, string>
): ParseResult {
  const findings: string[] = [];
  const sourceFile = parseEntrySource(entry);
  const flowLiteral = findFlowLiteral(sourceFile);
  if (flowLiteral === undefined) {
    unreadable(
      findings,
      "flow",
      "no `export const flow = { ... } satisfies FlowDefinition;` found — this source is not a rendered definition"
    );
    return {
      blueprint: {
        id: "",
        label: "",
        configSchema: [],
        workflows: [],
      },
      findings,
    };
  }
  const context: ParseContext = {
    sourceFile,
    bindings: buildBindingMap(sourceFile),
    files,
    findings,
    refs: [],
  };
  const blueprint = parseFlow(context, flowLiteral);
  verifyRefs(context);
  return { blueprint, findings };
}

// ─── flow level ──────────────────────────────────────────────────────

const FLOW_KEYS = [
  "id",
  "label",
  "description",
  "configSchema",
  "domainDir",
  "ui",
  "workflows",
  "operations",
  "tools",
  "actions",
  "edges",
] as const;

function parseFlow(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression
): FlowBlueprint {
  checkKeys(flowLiteral, FLOW_KEYS, "flow", context);
  const { findings } = context;

  const blueprint: FlowBlueprint = {
    id: requiredString(flowLiteral, "id", "flow", findings),
    label: requiredString(flowLiteral, "label", "flow", findings),
    configSchema: [],
    workflows: [],
  };
  const description = readString(flowLiteral, "description");
  if (description !== undefined) blueprint.description = description;
  const domainDir = readString(flowLiteral, "domainDir");
  if (domainDir !== undefined) blueprint.domainDir = domainDir;

  // Served component modules: `ui: { components: { "<id>": "<source>" } }` —
  // the sources are large JSON strings, read directly, never re-evaluated.
  const flowUi = readObject(flowLiteral, "ui");
  if (flowUi !== undefined) {
    for (const key of propertyNames(flowUi)) {
      if (key !== "components") {
        notSpecRepresentable(
          findings,
          "flow.ui",
          `flow-level ui property "${key}" is not spec-representable (only served components are)`
        );
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
          notSpecRepresentable(
            findings,
            "flow.ui.components",
            "a served component must map an id to a source string"
          );
          continue;
        }
        components[id] = source;
      }
      if (Object.keys(components).length > 0) {
        blueprint.ui = { components };
      }
    }
  }

  blueprint.configSchema = readConfigFields(
    readArray(flowLiteral, "configSchema"),
    "configSchema",
    findings
  );

  // The flow-level custom capabilities, parsed before the workflow walk so the
  // task tools/operations classify against them; their refs are pushed into
  // the inventory after the workflow walk (the renderer's own order).
  const workflowIds = workflowIdSet(context, flowLiteral);
  const tools = parseToolRefs(context, flowLiteral, workflowIds);
  const toolIds = new Set(tools.map((tool) => tool.id));
  const operations = parseOperationRefs(context, flowLiteral, workflowIds);
  const operationIds = new Set(operations.map((op) => op.id));
  if (tools.length > 0) blueprint.tools = tools;
  if (operations.length > 0) blueprint.operations = operations;

  // Workflows — the walk collects the gate/prompt/extract refs in the
  // renderer's traversal order.
  const workflowRefs = readIdentifierArray(flowLiteral, "workflows") ?? [];
  const workflows: WorkflowSpec[] = [];
  workflowRefs.forEach((ref, wfIndex) => {
    const wfLiteral = workflowConfigLiteral(context.sourceFile, ref);
    if (wfLiteral === undefined) {
      notSpecRepresentable(
        findings,
        `workflows[${wfIndex}]`,
        `workflow const "${ref}" is not a defineWorkflow call`
      );
      return;
    }
    const workflow = parseWorkflow(
      context,
      wfLiteral,
      wfIndex,
      toolIds,
      operationIds
    );
    if (workflow !== undefined) workflows.push(workflow);
  });
  blueprint.workflows = workflows;

  // Flow-level actions.
  const actions = parseFlowActions(context, flowLiteral);
  if (actions.length > 0) blueprint.actions = actions;

  // The flow-level tool/operation refs are pushed after the workflow walk,
  // then the edges' transform refs — the renderer's reference order.
  for (const [index, tool] of tools.entries()) {
    const binding = tool.ref;
    const info = context.bindings.get(binding);
    if (info !== undefined) {
      context.refs.push({
        kind: "tool",
        ref: tool.ref,
        exportName: info.exportName,
        id: tool.id,
        path: `tools[${index}]`,
      });
    }
  }
  for (const [index, op] of operations.entries()) {
    const info = context.bindings.get(op.ref);
    if (info !== undefined) {
      context.refs.push({
        kind: "operation",
        ref: op.ref,
        exportName: info.exportName,
        id: op.id,
        path: `operations[${index}]`,
      });
    }
  }
  blueprint.edges = parseEdges(context, flowLiteral);

  return blueprint;
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
  "taskOutputs",
  "workflowInstanceState",
  "states",
  "initial",
  "terminalStates",
] as const;

function parseWorkflow(
  context: ParseContext,
  wfLiteral: ts.ObjectLiteralExpression,
  wfIndex: number,
  toolIds: Set<string>,
  operationIds: Set<string>
): WorkflowSpec | undefined {
  const { findings, sourceFile } = context;
  const wfPath = `workflows[${wfIndex}]`;
  checkKeys(wfLiteral, WORKFLOW_KEYS, wfPath, context);

  const id = requiredString(wfLiteral, "id", wfPath, findings);
  const label = requiredString(wfLiteral, "label", wfPath, findings);
  const workflow: WorkflowSpec = {
    id,
    label,
    instanceState: [],
    initialState: requiredString(wfLiteral, "initial", wfPath, findings),
    terminalStates: readStringArray(wfLiteral, "terminalStates") ?? [],
    states: [],
  };

  const description = readString(wfLiteral, "description");
  if (description !== undefined) workflow.description = description;

  const instance = readObject(wfLiteral, "instance");
  if (instance !== undefined) {
    const title = readString(instance, "title");
    const subtitle = readString(instance, "subtitle");
    if (title !== undefined) {
      workflow.instance = { title };
      if (subtitle !== undefined) workflow.instance.subtitle = subtitle;
    } else {
      notSpecRepresentable(
        findings,
        `${wfPath}.instance`,
        "instance must carry a title"
      );
    }
  }

  const ui = readObject(wfLiteral, "ui");
  if (ui !== undefined) {
    for (const key of propertyNames(ui)) {
      if (key !== "view" && key !== "instanceComponent" && key !== "columns") {
        notSpecRepresentable(
          findings,
          `${wfPath}.ui`,
          `workflow ui property "${key}" is not spec-representable (only view, instanceComponent, and columns are)`
        );
      }
    }
    const view = readString(ui, "view");
    const instanceComponent = readString(ui, "instanceComponent");
    const columns = readBoardColumns(
      readArray(ui, "columns"),
      `${wfPath}.ui.columns`,
      findings
    );
    if (
      view !== undefined ||
      instanceComponent !== undefined ||
      columns !== undefined
    ) {
      workflow.ui = {};
      if (view !== undefined) workflow.ui.view = view as WorkflowView;
      if (instanceComponent !== undefined)
        workflow.ui.instanceComponent = instanceComponent;
      if (columns !== undefined) workflow.ui.columns = columns;
    }
  }

  const display = readObject(wfLiteral, "display");
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
    readArray(wfLiteral, "editFields"),
    `${wfPath}.editFields`,
    findings
  );
  if (editFields.length > 0) workflow.editFields = editFields;

  // The anchors: `taskOutputs: {} as <Type>` (ignored — the blueprint carries
  // no task outputs) and `workflowInstanceState: {} as <Type>` (recovered).
  if (property(wfLiteral, "taskOutputs") === undefined) {
    unreadable(
      findings,
      `${wfPath}.taskOutputs`,
      "missing the taskOutputs anchor the renderer emits"
    );
  } else if (anchorTypeName(wfLiteral, "taskOutputs") === undefined) {
    notSpecRepresentable(
      findings,
      `${wfPath}.taskOutputs`,
      "the taskOutputs anchor must be `{} as <Type>`"
    );
  }
  const stateAnchor = anchorTypeName(wfLiteral, "workflowInstanceState");
  if (stateAnchor === undefined) {
    notSpecRepresentable(
      findings,
      `${wfPath}.workflowInstanceState`,
      "the workflowInstanceState anchor must be `{} as <Type>`"
    );
    workflow.instanceState = [];
  } else if (stateAnchor === "Record") {
    workflow.instanceState = [];
  } else {
    const fields = instanceStateFromAlias(sourceFile, stateAnchor);
    if (fields === undefined) {
      notSpecRepresentable(
        findings,
        `${wfPath}.workflowInstanceState`,
        `the type alias "${stateAnchor}" is not a '<f>?: <T>;' literal`
      );
      workflow.instanceState = [];
    } else {
      workflow.instanceState = fields as InstanceStateField[];
    }
  }

  // The generated per-workflow machinery: the ops map (patch/extract ops) and
  // the completion tools array — both found by the const names the renderer
  // emits (`<wf>Operations`, `<wf>CompletionTools`).
  const patchOps = parseWorkflowOpsMap(context, wfIndex, id);
  const completionTools = parseWorkflowCompletionTools(context, wfIndex, id);

  workflow.states = parseStates(
    context,
    wfLiteral,
    wfIndex,
    id,
    patchOps,
    completionTools,
    toolIds,
    operationIds
  );
  return workflow;
}

// The workflow const references → their ids (used to classify the flow-level
// tools/operations merges' generated arrays).
function workflowIdSet(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression
): Set<string> {
  const ids = new Set<string>();
  for (const ref of readIdentifierArray(flowLiteral, "workflows") ?? []) {
    const literal = workflowConfigLiteral(context.sourceFile, ref);
    const id = literal === undefined ? undefined : readString(literal, "id");
    if (id !== undefined) ids.add(id);
  }
  return ids;
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

function parseStates(
  context: ParseContext,
  wfLiteral: ts.ObjectLiteralExpression,
  wfIndex: number,
  workflowId: string,
  patchOps: WorkflowOpSpecs,
  completionTools: Map<string, CompletionOutputField[]>,
  toolIds: Set<string>,
  operationIds: Set<string>
): StateSpec[] {
  const states: StateSpec[] = [];
  (readArray(wfLiteral, "states") ?? []).forEach((element, sIndex) => {
    const sPath = `workflows[${wfIndex}].states[${sIndex}]`;
    const state = parseState(
      context,
      element,
      sPath,
      workflowId,
      patchOps,
      completionTools,
      toolIds,
      operationIds
    );
    if (state !== undefined) states.push(state);
  });
  return states;
}

function parseState(
  context: ParseContext,
  element: ts.Expression,
  sPath: string,
  workflowId: string,
  patchOps: WorkflowOpSpecs,
  completionTools: Map<string, CompletionOutputField[]>,
  toolIds: Set<string>,
  operationIds: Set<string>
): StateSpec | undefined {
  const { findings } = context;
  const obj = unwrap(element);
  if (!ts.isObjectLiteralExpression(obj)) {
    notSpecRepresentable(findings, sPath, "a state must be an object literal");
    return undefined;
  }
  checkKeys(obj, STATE_KEYS, sPath, context);
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

  const tasks: TaskSpec[] = [];
  (readArray(obj, "tasks") ?? []).forEach((taskElement, tIndex) => {
    const tPath = `${sPath}.tasks[${tIndex}]`;
    const task = parseTask(
      context,
      taskElement,
      tPath,
      workflowId,
      patchOps,
      completionTools,
      toolIds,
      operationIds
    );
    if (task !== undefined) tasks.push(task);
  });
  if (tasks.length > 0) state.tasks = tasks;

  const transitions = parseAutoTransitions(context, obj, sPath);
  if (transitions.length > 0) state.autoTransitions = transitions;

  const actions = parseStateActions(context, obj, sPath);
  if (actions.length > 0) state.actions = actions;
  return state;
}

// ─── tasks ───────────────────────────────────────────────────────────

const TASK_KEYS = [
  "id",
  "label",
  "trigger",
  "role",
  "operations",
  "operationInputs",
  "tools",
  "completionTool",
  "completionSignal",
  "systemPrompt",
  "startOnUserInput",
  "workspacePath",
  "inputFromInstanceState",
  "persist",
] as const;

function parseTask(
  context: ParseContext,
  element: ts.Expression,
  tPath: string,
  workflowId: string,
  patchOps: WorkflowOpSpecs,
  completionTools: Map<string, CompletionOutputField[]>,
  toolIds: Set<string>,
  operationIds: Set<string>
): TaskSpec | undefined {
  const { findings } = context;
  const obj = unwrap(element);
  if (!ts.isObjectLiteralExpression(obj)) {
    notSpecRepresentable(findings, tPath, "a task must be an object literal");
    return undefined;
  }
  checkKeys(obj, TASK_KEYS, tPath, context);

  const id = requiredString(obj, "id", tPath, findings);
  const label = readString(obj, "label") ?? id;
  const role = readString(obj, "role");
  const task: TaskSpec = {
    id,
    label,
    role: (role === "operation" || role === "ai-task" || role === "ai-chat"
      ? role
      : "operation") as TaskSpec["role"],
  };
  if (role !== "operation" && role !== "ai-task" && role !== "ai-chat") {
    notSpecRepresentable(
      findings,
      `${tPath}.role`,
      `task role ${JSON.stringify(role)} is not spec-representable`
    );
  }
  const trigger = readString(obj, "trigger");
  if (trigger !== undefined && trigger !== "auto") {
    notSpecRepresentable(
      findings,
      `${tPath}.trigger`,
      `task trigger ${JSON.stringify(trigger)} is not spec-representable (only "auto")`
    );
  }

  // The generated op names: `<wf>_<task>_patch` / `<wf>_<task>_extract` are
  // reversed into patch/extract and removed from the operations list.
  const patchName = `${workflowId}_${id}_patch`;
  const extractName = `${workflowId}_${id}_extract`;
  const completionName = `${workflowId}_${id}_complete`;

  const operations: (string | { ref: string })[] = [];
  for (const opName of readStringArray(obj, "operations") ?? []) {
    if (opName === patchName) continue;
    if (opName === extractName) continue;
    if (engineOpNames.has(opName) || operationIds.has(opName)) {
      operations.push(opName);
    } else {
      notSpecRepresentable(
        findings,
        `${tPath}.operations`,
        `operation name ${JSON.stringify(opName)} is not an engine op or a flow-level custom op id`
      );
      operations.push(opName);
    }
  }
  if (operations.length > 0) task.operations = operations;

  const operationInputs = readObject(obj, "operationInputs");
  if (operationInputs !== undefined) {
    task.operationInputs = literalJson(operationInputs) as Record<
      string,
      unknown
    >;
  }

  // Tools: the generated completion tool is offered automatically and removed;
  // the rest are infrastructure names or flow-level custom tool ids.
  const tools: string[] = [];
  for (const toolName of readStringArray(obj, "tools") ?? []) {
    if (toolName === completionName) continue;
    if (infraToolNames.has(toolName) || toolIds.has(toolName)) {
      tools.push(toolName);
    } else {
      notSpecRepresentable(
        findings,
        `${tPath}.tools`,
        `tool name ${JSON.stringify(toolName)} is not an infrastructure tool or a flow-level custom tool id`
      );
      tools.push(toolName);
    }
  }
  if (tools.length > 0) task.tools = tools;

  const completionTool = readString(obj, "completionTool");
  if (completionTool !== undefined) {
    if (completionTool === "complete_task") {
      task.completionTool = completionTool;
    } else if (completionTool === completionName) {
      const fields = completionTools.get(completionTool);
      if (fields !== undefined) {
        task.completionOutput = fields;
      } else {
        notSpecRepresentable(
          findings,
          `${tPath}.completionTool`,
          `completion tool "${completionTool}" is not in the generated ${workflowId}CompletionTools array`
        );
        task.completionTool = completionTool;
      }
    } else {
      notSpecRepresentable(
        findings,
        `${tPath}.completionTool`,
        `completion tool ${JSON.stringify(completionTool)} is not spec-representable (only "complete_task" or a generated <wf>_<task>_complete tool)`
      );
      task.completionTool = completionTool;
    }
  }

  const completionSignal = readString(obj, "completionSignal");
  if (completionSignal !== undefined) task.completionSignal = completionSignal;

  // The system prompt: a referenced prompt const (an import binding) or an
  // inline string literal.
  const systemPromptProp = property(obj, "systemPrompt");
  if (systemPromptProp !== undefined) {
    const promptValue = unwrap(systemPromptProp.initializer);
    if (ts.isStringLiteral(promptValue)) {
      task.systemPrompt = promptValue.text;
    } else if (ts.isIdentifier(promptValue)) {
      const binding = promptValue.text;
      const info = context.bindings.get(binding);
      if (info !== undefined) {
        task.systemPromptRef = info.ref;
        context.refs.push({
          kind: "prompt",
          ref: info.ref,
          exportName: info.exportName,
          workflowId,
          taskId: id,
          path: `${tPath}.systemPromptRef`,
        });
      } else {
        notSpecRepresentable(
          findings,
          `${tPath}.systemPrompt`,
          `system prompt binding "${binding}" is not an imported reference`
        );
      }
    } else {
      notSpecRepresentable(
        findings,
        `${tPath}.systemPrompt`,
        "a system prompt must be a string literal or a referenced prompt import"
      );
    }
  }

  const startOnUserInput = readBool(obj, "startOnUserInput");
  if (startOnUserInput !== undefined) task.startOnUserInput = startOnUserInput;
  const workspacePath = readString(obj, "workspacePath");
  if (workspacePath !== undefined) task.workspacePath = workspacePath;
  const inputFromInstanceState = readString(obj, "inputFromInstanceState");
  if (inputFromInstanceState !== undefined) {
    task.inputFromInstanceState = inputFromInstanceState;
  }
  const persist = readObject(obj, "persist");
  if (persist !== undefined) {
    for (const key of propertyNames(persist)) {
      if (key !== "path") {
        notSpecRepresentable(
          findings,
          `${tPath}.persist`,
          `persist property "${key}" is not spec-representable (only path)`
        );
      }
    }
    const persistPath = readString(persist, "path");
    if (persistPath !== undefined) task.persist = { path: persistPath };
  }

  // The generated patch/extract op for this task (from the workflow ops map).
  const generated = patchOps.get(id);
  if (generated !== undefined) {
    if (generated.kind === "patch") {
      task.patch = generated.patch;
    } else {
      const info = context.bindings.get(generated.binding);
      if (info !== undefined) {
        task.extract = { ref: info.ref, fields: generated.fields };
        context.refs.push({
          kind: "extract",
          ref: info.ref,
          exportName: info.exportName,
          fields: generated.fields,
          workflowId,
          taskId: id,
          path: `${tPath}.extract`,
        });
      } else {
        notSpecRepresentable(
          findings,
          `${tPath}.extract`,
          `extract binding "${generated.binding}" is not an imported reference`
        );
      }
    }
  }
  return task;
}

// ─── auto transitions / actions ──────────────────────────────────────

function parseAutoTransitions(
  context: ParseContext,
  stateObj: ts.ObjectLiteralExpression,
  sPath: string
): { to: string; gate: GateSpec }[] {
  const transitions: { to: string; gate: GateSpec }[] = [];
  (readArray(stateObj, "autoTransitions") ?? []).forEach((element, tIndex) => {
    const tPath = `${sPath}.autoTransitions[${tIndex}]`;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      notSpecRepresentable(
        context.findings,
        tPath,
        "an auto transition must be an object literal"
      );
      return;
    }
    checkKeys(obj, ["to", "gate"], tPath, context);
    const to = requiredString(obj, "to", tPath, context.findings);
    const gate = parseGateClosure(context, obj, `${tPath}.gate`);
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

function parseStateActions(
  context: ParseContext,
  stateObj: ts.ObjectLiteralExpression,
  sPath: string
): ActionSpec[] {
  const actions: ActionSpec[] = [];
  (readArray(stateObj, "actions") ?? []).forEach((element, aIndex) => {
    const aPath = `${sPath}.actions[${aIndex}]`;
    const action = parseAction(context, element, aPath, STATE_ACTION_KEYS);
    if (action !== undefined) actions.push(action);
  });
  return actions;
}

// The gate property `gate: (ctx) => <expr>` → GateSpec.
function parseGateClosure(
  context: ParseContext,
  obj: ts.ObjectLiteralExpression,
  gatePath: string
): GateSpec | undefined {
  const gateProp = property(obj, "gate");
  if (gateProp === undefined) {
    unreadable(
      context.findings,
      gatePath,
      "missing the gate the renderer emits"
    );
    return undefined;
  }
  const gateValue = unwrap(gateProp.initializer);
  if (!ts.isArrowFunction(gateValue) || gateValue.parameters.length !== 1) {
    notSpecRepresentable(
      context.findings,
      gatePath,
      "a gate must be a `(ctx) => ...` closure"
    );
    return undefined;
  }
  if (ts.isBlock(gateValue.body)) {
    notSpecRepresentable(
      context.findings,
      gatePath,
      "a gate closure body must be an expression, not a block"
    );
    return undefined;
  }
  const gate = parseGate(gateValue.body, context, gatePath);
  if (gate === undefined) {
    notSpecRepresentable(
      context.findings,
      gatePath,
      "the gate closure does not match a structured GateSpec emission"
    );
    return undefined;
  }
  return gate;
}

function parseAction(
  context: ParseContext,
  element: ts.Expression,
  aPath: string,
  keys: readonly string[]
): ActionSpec | undefined {
  const { findings } = context;
  const obj = unwrap(element);
  if (!ts.isObjectLiteralExpression(obj)) {
    notSpecRepresentable(
      findings,
      aPath,
      "an action must be an object literal"
    );
    return undefined;
  }
  checkKeys(obj, keys, aPath, context);
  const action: ActionSpec = {
    id: requiredString(obj, "id", aPath, findings),
    label: requiredString(obj, "label", aPath, findings),
  };
  const variant = readString(obj, "variant");
  if (variant !== undefined) action.variant = variant as ActionSpec["variant"];
  const confirmText = readString(obj, "confirmText");
  if (confirmText !== undefined) action.confirmText = confirmText;
  if (property(obj, "gate") !== undefined) {
    const gate = parseGateClosure(context, obj, `${aPath}.gate`);
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
    context,
    obj,
    `${aPath}.createInstance`
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

// ─── flow-level actions ──────────────────────────────────────────────

const FLOW_ACTION_KEYS = [
  "id",
  "label",
  "variant",
  "gate",
  "createInstance",
  "dispatchToAll",
] as const;

function parseFlowActions(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression
): FlowLevelActionSpec[] {
  const actions: FlowLevelActionSpec[] = [];
  (readArray(flowLiteral, "actions") ?? []).forEach((element, aIndex) => {
    const aPath = `actions[${aIndex}]`;
    const { findings } = context;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      notSpecRepresentable(
        findings,
        aPath,
        "a flow-level action must be an object literal"
      );
      return;
    }
    checkKeys(obj, FLOW_ACTION_KEYS, aPath, context);
    const action: FlowLevelActionSpec = {
      id: requiredString(obj, "id", aPath, findings),
      label: requiredString(obj, "label", aPath, findings),
    };
    const variant = readString(obj, "variant");
    if (variant !== undefined)
      action.variant = variant as FlowLevelActionSpec["variant"];
    if (property(obj, "gate") !== undefined) {
      const gate = parseGateClosure(context, obj, `${aPath}.gate`);
      if (gate !== undefined) action.gate = gate;
    }
    const createInstance = readCreateInstance(
      context,
      obj,
      `${aPath}.createInstance`
    );
    if (createInstance !== undefined) action.createInstance = createInstance;
    const dispatchToAll = readObject(obj, "dispatchToAll");
    if (dispatchToAll !== undefined) {
      const workflowId = readString(dispatchToAll, "workflowId");
      const actionId = readString(dispatchToAll, "actionId");
      if (workflowId !== undefined && actionId !== undefined) {
        action.dispatchToAll = { workflowId, actionId };
      } else {
        notSpecRepresentable(
          findings,
          `${aPath}.dispatchToAll`,
          "dispatchToAll must carry workflowId and actionId"
        );
      }
    }
    actions.push(action);
  });
  return actions;
}

function readCreateInstance(
  context: ParseContext,
  obj: ts.ObjectLiteralExpression,
  path: string
):
  | { workflowId: string; fields: ReturnType<typeof readConfigFields> }
  | undefined {
  const create = readObject(obj, "createInstance");
  if (create === undefined) return undefined;
  const workflowId = readString(create, "workflowId");
  if (workflowId === undefined) {
    notSpecRepresentable(
      context.findings,
      path,
      "createInstance must carry a workflowId"
    );
    return undefined;
  }
  return {
    workflowId,
    fields: readConfigFields(
      readArray(create, "fields"),
      `${path}.fields`,
      context.findings
    ),
  };
}

// ─── edges ───────────────────────────────────────────────────────────

const EDGE_KEYS = [
  "fromWorkflow",
  "fromStates",
  "toWorkflow",
  "transform",
] as const;

function parseEdges(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression
): EdgeSpec[] {
  const edges: EdgeSpec[] = [];
  (readArray(flowLiteral, "edges") ?? []).forEach((element, eIndex) => {
    const ePath = `edges[${eIndex}]`;
    const { findings } = context;
    const obj = unwrap(element);
    if (!ts.isObjectLiteralExpression(obj)) {
      notSpecRepresentable(
        findings,
        ePath,
        "an edge must be an object literal"
      );
      return;
    }
    checkKeys(obj, EDGE_KEYS, ePath, context);
    const edge: EdgeSpec = {
      fromWorkflow: requiredString(obj, "fromWorkflow", ePath, findings),
      fromStates: readStringArray(obj, "fromStates") ?? [],
      toWorkflow: requiredString(obj, "toWorkflow", ePath, findings),
    };
    const transformProp = property(obj, "transform");
    if (transformProp === undefined) {
      unreadable(findings, ePath, "missing the transform the renderer emits");
      edges.push(edge);
      return;
    }
    const transformValue = unwrap(transformProp.initializer);
    if (!ts.isArrowFunction(transformValue)) {
      notSpecRepresentable(
        findings,
        `${ePath}.transform`,
        "an edge transform must be a `(source) => ...` closure"
      );
      edges.push(edge);
      return;
    }
    const parsed = parseEdgeTransform(
      transformValue,
      context,
      `${ePath}.transform`
    );
    if (parsed === undefined) {
      notSpecRepresentable(
        findings,
        `${ePath}.transform`,
        "the transform closure does not match one of the four emitted shapes (fields, empty signal, fan-out, or a referenced transform)"
      );
      edges.push(edge);
      return;
    }
    if (parsed.kind === "fields" && Object.keys(parsed.fields).length > 0) {
      edge.fields = parsed.fields;
    } else if (parsed.kind === "fanOut") {
      edge.fanOut = parsed.fanOut;
    } else if (parsed.kind === "transform") {
      edge.transform = parsed.transform;
    }
    edges.push(edge);
  });
  return edges;
}

// ─── generated per-workflow machinery ────────────────────────────────

// The `<wf>Operations` map → per-task patch/extract specs (keyed by the task
// id inside the generated `<wf>_<task>_patch` / `<wf>_<task>_extract` names).
function parseWorkflowOpsMap(
  context: ParseContext,
  wfIndex: number,
  workflowId: string
): WorkflowOpSpecs {
  const out: WorkflowOpSpecs = new Map();
  const wfPath = `workflows[${wfIndex}]`;
  const initializer = findModuleConst(
    context.sourceFile,
    `${workflowId}Operations`
  );
  if (initializer === undefined) return out;
  const value = unwrap(initializer);
  const group =
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "defineOperations"
      ? value.arguments[0]
      : value;
  if (!group || !ts.isObjectLiteralExpression(group)) {
    notSpecRepresentable(
      context.findings,
      wfPath,
      `the ${workflowId}Operations export is not a defineOperations map`
    );
    return out;
  }
  const prefix = `${workflowId}_`;
  for (const prop of group.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const key = prop.name.text;
    if (key.endsWith("_patch") && key.startsWith(prefix)) {
      const taskId = key.slice(prefix.length, -"_patch".length);
      const patch = parsePatchOp(prop.initializer);
      if (patch !== undefined) {
        out.set(taskId, { kind: "patch", patch });
      } else {
        notSpecRepresentable(
          context.findings,
          wfPath,
          `the ${key} op body does not match the generated patch emission`
        );
      }
    } else if (key.endsWith("_extract") && key.startsWith(prefix)) {
      const taskId = key.slice(prefix.length, -"_extract".length);
      const extract = parseExtractOp(prop.initializer);
      if (extract !== undefined) {
        out.set(taskId, { kind: "extract", ...extract });
      } else {
        notSpecRepresentable(
          context.findings,
          wfPath,
          `the ${key} op body does not match the generated extract emission`
        );
      }
    } else {
      notSpecRepresentable(
        context.findings,
        wfPath,
        `the ${key} op is not a generated ${workflowId}_<task>_patch/_extract op`
      );
    }
  }
  return out;
}

// The patch op body → the patch map: the patchWorkflowInstanceState literal's
// values are hoisted readPath consts, `ctx.instanceId`, or literals.
function parsePatchOp(
  initializer: ts.Expression
): Record<string, ValueSpec> | undefined {
  const fn = opFunction(initializer);
  if (fn === undefined) return undefined;
  const patchCall = findPatchCall(fn);
  if (patchCall === undefined) return undefined;
  const arg = patchCall.arguments[0];
  if (arg === undefined) return undefined;
  const literal = unwrap(arg);
  if (!ts.isObjectLiteralExpression(literal)) return undefined;
  const patch: Record<string, ValueSpec> = {};
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      return undefined;
    }
    const value = parsePatchValue(prop.initializer, fn);
    if (value === undefined) return undefined;
    patch[prop.name.text] = value;
  }
  return patch;
}

// The extract op body → the referenced extractor binding and the patched
// field names (`extracted.<field> as <T> | undefined` writes).
function parseExtractOp(
  initializer: ts.Expression
): { binding: string; fields: string[] } | undefined {
  const fn = opFunction(initializer);
  if (fn === undefined) return undefined;
  const decl = findConstInitializer(fn, "extracted");
  if (decl === undefined) return undefined;
  const call = unwrap(decl);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) {
    return undefined;
  }
  const binding = call.expression.text;
  const patchCall = findPatchCall(fn);
  if (patchCall === undefined) return undefined;
  const arg = patchCall.arguments[0];
  if (arg === undefined) return undefined;
  const literal = unwrap(arg);
  if (!ts.isObjectLiteralExpression(literal)) return undefined;
  const fields: string[] = [];
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      return undefined;
    }
    // `extracted.<field> as <T> | undefined` — the accessed name must match
    // the written key (the renderer emits `extracted.<field>` per key).
    const access = extractedAccess(prop.initializer, "extracted");
    if (access === undefined || access !== prop.name.text) return undefined;
    fields.push(prop.name.text);
  }
  return { binding, fields };
}

// The `<wf>CompletionTools` array → tool name → completion contract fields.
function parseWorkflowCompletionTools(
  context: ParseContext,
  wfIndex: number,
  workflowId: string
): Map<string, CompletionOutputField[]> {
  const initializer = findModuleConst(
    context.sourceFile,
    `${workflowId}CompletionTools`
  );
  if (initializer === undefined) return new Map();
  const value = unwrap(initializer);
  if (!ts.isArrayLiteralExpression(value)) {
    notSpecRepresentable(
      context.findings,
      `workflows[${wfIndex}]`,
      `the ${workflowId}CompletionTools export is not a tool array`
    );
    return new Map();
  }
  return readCompletionTools(value.elements);
}

// ─── flow-level capabilities ─────────────────────────────────────────

function parseToolRefs(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression,
  workflowIds: Set<string>
): ToolRefSpec[] {
  const tools: ToolRefSpec[] = [];
  (readArray(flowLiteral, "tools") ?? []).forEach((element, index) => {
    const tPath = `tools[${index}]`;
    const binding = spreadBinding(context, element, tPath);
    if (binding === undefined) return;
    if (
      binding.endsWith("CompletionTools") &&
      workflowIds.has(binding.slice(0, -"CompletionTools".length))
    ) {
      return; // a workflow's generated completion-tool array, not a tool ref
    }
    if (!binding.endsWith("Tools")) {
      notSpecRepresentable(
        context.findings,
        tPath,
        `the ${binding} spread is not a tool list (expected <id>Tools)`
      );
      return;
    }
    const info = context.bindings.get(binding);
    if (info === undefined) {
      notSpecRepresentable(
        context.findings,
        tPath,
        `the ${binding} spread is not an imported reference`
      );
      return;
    }
    const id = binding.slice(0, -"Tools".length);
    const writes = recoverToolWrites(info.ref, id, context.files);
    const tool: ToolRefSpec = { id, ref: info.ref };
    if (writes !== undefined && writes.length > 0) tool.writes = writes;
    tools.push(tool);
  });
  return tools;
}

function parseOperationRefs(
  context: ParseContext,
  flowLiteral: ts.ObjectLiteralExpression,
  workflowIds: Set<string>
): OperationRefSpec[] {
  const operations: OperationRefSpec[] = [];
  const merge = readObject(flowLiteral, "operations");
  if (merge === undefined) return operations;
  for (const element of merge.properties) {
    if (!ts.isSpreadAssignment(element)) {
      notSpecRepresentable(
        context.findings,
        "flow.operations",
        "the operations merge must be spreads of `<id>Operations` maps"
      );
      continue;
    }
    const bindingValue = unwrap(element.expression);
    if (!ts.isIdentifier(bindingValue)) {
      notSpecRepresentable(
        context.findings,
        "flow.operations",
        "the operations merge must spread imported bindings"
      );
      continue;
    }
    const binding = bindingValue.text;
    if (
      binding.endsWith("Operations") &&
      workflowIds.has(binding.slice(0, -"Operations".length))
    ) {
      continue; // a workflow's generated patch/extract map, not an op ref
    }
    if (!binding.endsWith("Operations")) {
      notSpecRepresentable(
        context.findings,
        "flow.operations",
        `the ${binding} spread is not an operations map (expected <id>Operations)`
      );
      continue;
    }
    const info = context.bindings.get(binding);
    if (info === undefined) {
      notSpecRepresentable(
        context.findings,
        "flow.operations",
        `the ${binding} spread is not an imported reference`
      );
      continue;
    }
    const id = binding.slice(0, -"Operations".length);
    const writes = recoverOperationWrites(info.ref, id, context.files);
    const op: OperationRefSpec = { id, ref: info.ref };
    if (writes !== undefined && writes.length > 0) op.writes = writes;
    operations.push(op);
  }
  return operations;
}

// ─── helpers ─────────────────────────────────────────────────────────

function spreadBinding(
  context: ParseContext,
  element: ts.Expression,
  path: string
): string | undefined {
  const value = unwrap(element);
  if (!ts.isSpreadElement(value) || !ts.isIdentifier(value.expression)) {
    notSpecRepresentable(
      context.findings,
      path,
      "expected a spread of an imported binding"
    );
    return undefined;
  }
  return value.expression.text;
}

function verifyRefs(context: ParseContext): void {
  for (const ref of context.refs) {
    const expected = expectedExportName(
      ref.kind,
      ref.kind === "tool" || ref.kind === "operation"
        ? { id: ref.id, ref: ref.ref }
        : { ref: ref.ref }
    );
    if (ref.exportName !== expected) {
      notSpecRepresentable(
        context.findings,
        ref.path,
        `import binding "${ref.exportName}" does not match the expected export name "${expected}" for ${ref.ref}`
      );
    }
    if (context.files !== undefined && !(ref.ref in context.files)) {
      unreadable(
        context.findings,
        ref.path,
        `referenced file ${ref.ref} is not in the session's files`
      );
    }
  }
}

function checkKeys(
  obj: ts.ObjectLiteralExpression,
  known: readonly string[],
  path: string,
  context: ParseContext
): void {
  for (const name of propertyNames(obj)) {
    if (!known.includes(name)) {
      notSpecRepresentable(
        context.findings,
        path,
        `the "${name}" property is not spec-representable`
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
    unreadable(findings, path, `missing required "${key}"`);
    return "";
  }
  return value;
}

// The op value: an arrow function or a function declaration.
function opFunction(
  initializer: ts.Expression
): ts.FunctionLikeDeclaration | undefined {
  const value = unwrap(initializer);
  if (ts.isArrowFunction(value)) return value;
  if (ts.isFunctionExpression(value)) return value;
  return undefined;
}

function findPatchCall(
  fn: ts.FunctionLikeDeclaration
): ts.CallExpression | undefined {
  if (fn.body === undefined) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "patchWorkflowInstanceState"
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

function findConstInitializer(
  fn: ts.FunctionLikeDeclaration,
  name: string
): ts.Expression | undefined {
  if (fn.body === undefined) return undefined;
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

// `extracted.<field> as <T> | undefined` → the accessed field name.
function extractedAccess(
  expr: ts.Expression,
  baseName: string
): string | undefined {
  const value = unwrap(expr);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.name)) {
    return undefined;
  }
  const base = unwrap(value.expression);
  if (!ts.isIdentifier(base) || base.text !== baseName) return undefined;
  return value.name.text;
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
            kind: field.render.kind as BuiltinRenderKind,
            ...(field.render.props !== undefined
              ? { props: field.render.props }
              : {}),
          },
        }
      : {}),
    ...(field.derive !== undefined ? { derive: field.derive } : {}),
  };
}
