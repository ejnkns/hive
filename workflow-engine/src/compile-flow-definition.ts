/** @public — the engine-owned compile step: a pure-data FlowDefinition → the
 * runtime projection (CompiledFlowDefinition) with closures for gates and
 * transforms, ops/tools resolved by name. This is the renderer's emission
 * logic relocated into the engine, operating on the canonical definition
 * instead of emitting text.
 *
 * The compile runs once at registration, deterministic and cached by the
 * caller. It receives a `resolveRef` provided by the loader, which imports
 * the referenced modules (`./gates/approved.ts` etc.); the definition itself
 * stays pure data. The runtime contract (gates/transforms as functions,
 * ops/tools by name) never changes — this step is where the authoring seam
 * moved, not the runtime seam. */

import type { OperationFn } from "./runners/create-operation-runner.ts";
import { defineTool } from "./runners/define-tool.ts";
import type { Tool } from "./runners/tool-types.ts";
import type { RuntimeGateContext } from "./workflow-types/core.ts";
import type {
  ActionSpec,
  CompletionOutputField,
  EdgeSpec,
  FieldType,
  GateSpec,
  ModuleRefKind,
  StateSpec,
  TaskSpec,
  ValueSpec,
} from "./workflow-types/definition-vocabulary.ts";
import type { OutputExtractor } from "./workflow-types/extractor.ts";
import type {
  CompiledFlowDefinition,
  FlowDefinition,
  FlowEdge,
  FlowLevelAction,
  RuntimeFlowEdge,
  TransformContract,
} from "./workflow-types/flow-definition.ts";
import type {
  RuntimeWorkflowConfig,
  StateTaskDef,
} from "./workflow-types/state-config.ts";

// A referenced module's namespace as the loader imports it. The compile step
// picks the named export by kind convention (see refExportName).
export type RefResolver = (ref: string) => Record<string, unknown>;

// One referenced module of a definition, with the kind that determines the
// export name the compile step and the module-set lint use. The compile step
// and the loader consume only kind + ref; the lint also needs the export
// name, the definition path of the reference (for findings), and the id
// (tool/op refs — the harness pins the map's key).
export type DefinitionReference =
  | {
      kind: "gate";
      ref: string;
      exportName: string;
      // The definition path of the reference (e.g. "workflows[0].states[0].autoTransitions[1].gate").
      path: string;
    }
  | {
      kind: "tool";
      ref: string;
      exportName: string;
      id: string;
      path: string;
    }
  | {
      kind: "operation";
      ref: string;
      exportName: string;
      id: string;
      path: string;
    }
  | {
      kind: "transform";
      ref: string;
      exportName: string;
      fields: string[];
      path: string;
    }
  | {
      kind: "extract";
      ref: string;
      exportName: string;
      fields: string[];
      workflowId: string;
      taskId: string;
      path: string;
    }
  | {
      kind: "prompt";
      ref: string;
      exportName: string;
      workflowId: string;
      taskId: string;
      path: string;
    }
  | {
      kind: "component";
      ref: string;
      // The component module contract is a default-export factory (the lit
      // runtime is injected); the module-set lint pins the default export.
      exportName: "default";
      // The component id — the ui.components key the definition and the
      // serve path both key on.
      id: string;
      path: string;
    };

// ─── ref naming (the reference-identity authority) ────────────────────

export function fileBaseName(ref: string): string {
  const segments = ref.replace(/\\/g, "/").split("/");
  const leaf = segments[segments.length - 1] ?? "";
  return leaf.endsWith(".ts") ? leaf.slice(0, -3) : leaf;
}

// `review-gate.ts` → `reviewGate`; `websearch.ts` → `websearch`.
export function camelCaseId(kebab: string): string {
  return kebab
    .split(/[^A-Za-z0-9_$]+/)
    .filter((part) => part !== "")
    .map((part, index) =>
      index === 0 ? part : part[0].toUpperCase() + part.slice(1)
    )
    .join("");
}

// The export name a reference's module declares. Gates/transforms/extracts/
// prompts export the camel-cased file base name; tools export `<id>Tools` (a
// tool list); operations export `<id>Operations` (an ops map).
export function refExportName(
  kind: ModuleRefKind,
  idOrRef: { id: string; ref: string } | { ref: string }
): string {
  if (kind === "tool" || kind === "operation") {
    const id = "id" in idOrRef ? idOrRef.id : fileBaseName(idOrRef.ref);
    return kind === "tool" ? `${id}Tools` : `${id}Operations`;
  }
  return camelCaseId(fileBaseName(idOrRef.ref));
}

// The op name an inline task operation reference registers under: the file
// base name of the ref (`./ops/annotate.ts` → `annotate`). Tasks reference
// the op by this name; the module exports the `<name>Operations` map.
export function opNameOf(ref: string): string {
  return fileBaseName(ref);
}

// ─── reference inventory ──────────────────────────────────────────────

// Every referenced module of a definition, deduplicated by kind + ref (a gate
// file nested in and/or appears once; the same file referenced as a gate and
// as a prompt is two refs). The loader pre-imports exactly these so the
// compile step's resolveRef never misses; the module-set lint checks each
// against its contract.
export function collectDefinitionRefs(
  form: FlowDefinition
): DefinitionReference[] {
  const refs: DefinitionReference[] = [];
  const seen = new Set<string>();
  const add = (ref: DefinitionReference): void => {
    const key = `${ref.kind}:${ref.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  const walkGate = (gate: GateSpec, path: string): void => {
    if (gate.kind === "file") {
      add({
        kind: "gate",
        ref: gate.ref,
        exportName: refExportName("gate", { ref: gate.ref }),
        path,
      });
      return;
    }
    if (gate.kind === "not") {
      walkGate(gate.gate, `${path}.gate`);
      return;
    }
    if (gate.kind === "and" || gate.kind === "or") {
      for (const [i, g] of gate.gates.entries()) {
        walkGate(g, `${path}.gates[${i}]`);
      }
    }
  };

  for (const [tIndex, tool] of (form.tools ?? []).entries()) {
    add({
      kind: "tool",
      ref: tool.ref,
      exportName: refExportName("tool", { id: tool.id, ref: tool.ref }),
      id: tool.id,
      path: `tools[${tIndex}]`,
    });
  }
  for (const [oIndex, op] of (form.operations ?? []).entries()) {
    add({
      kind: "operation",
      ref: op.ref,
      exportName: refExportName("operation", { id: op.id, ref: op.ref }),
      id: op.id,
      path: `operations[${oIndex}]`,
    });
  }
  for (const [componentId, spec] of Object.entries(form.ui?.components ?? {})) {
    if (typeof spec === "string") continue;
    add({
      kind: "component",
      ref: spec.ref,
      exportName: "default",
      id: componentId,
      path: `ui.components["${componentId}"]`,
    });
  }
  for (const [wfIndex, wf] of form.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    for (const [sIndex, state] of wf.states.entries()) {
      const sPath = `${wfPath}.states[${sIndex}]`;
      for (const [tIndex, task] of (state.tasks ?? []).entries()) {
        const tPath = `${sPath}.tasks[${tIndex}]`;
        for (const op of task.operations ?? []) {
          if (typeof op === "string") continue;
          const id = opNameOf(op.ref);
          add({
            kind: "operation",
            ref: op.ref,
            exportName: refExportName("operation", { id, ref: op.ref }),
            id,
            path: `${tPath}.operations`,
          });
        }
        if (task.systemPromptRef !== undefined) {
          add({
            kind: "prompt",
            ref: task.systemPromptRef,
            exportName: refExportName("prompt", { ref: task.systemPromptRef }),
            workflowId: wf.id,
            taskId: task.id,
            path: `${tPath}.systemPromptRef`,
          });
        }
        if (task.extract !== undefined) {
          add({
            kind: "extract",
            ref: task.extract.ref,
            exportName: refExportName("extract", { ref: task.extract.ref }),
            fields: task.extract.fields,
            workflowId: wf.id,
            taskId: task.id,
            path: `${tPath}.extract`,
          });
        }
      }
      for (const [tIndex, transition] of (
        state.autoTransitions ?? []
      ).entries()) {
        walkGate(transition.gate, `${sPath}.autoTransitions[${tIndex}].gate`);
      }
      for (const [aIndex, action] of (state.actions ?? []).entries()) {
        if (action.gate !== undefined) {
          walkGate(action.gate, `${sPath}.actions[${aIndex}].gate`);
        }
      }
    }
  }
  for (const [aIndex, action] of (form.actions ?? []).entries()) {
    if (action.gate !== undefined) {
      walkGate(action.gate, `actions[${aIndex}].gate`);
    }
  }
  for (const [eIndex, edge] of (form.edges ?? []).entries()) {
    if (edge.transform !== undefined) {
      add({
        kind: "transform",
        ref: edge.transform.ref,
        exportName: refExportName("transform", { ref: edge.transform.ref }),
        fields: edge.transform.fields,
        path: `edges[${eIndex}].transform`,
      });
    }
  }
  return refs;
}

// ─── the compile step ─────────────────────────────────────────────────

export function compileFlowDefinition(
  form: FlowDefinition,
  resolveRef: RefResolver
): CompiledFlowDefinition & { workflows: RuntimeWorkflowConfig[] } {
  const operations: Record<string, OperationFn> = {};
  const tools: Tool[] = [];
  const workflows: RuntimeWorkflowConfig[] = [];

  // Flow-level capability refs: merge each referenced ops map / tool list.
  for (const op of form.operations ?? []) {
    const map = resolveRef(op.ref)[
      refExportName("operation", { id: op.id, ref: op.ref })
    ] as Record<string, OperationFn> | undefined;
    if (map !== undefined) Object.assign(operations, map);
  }
  for (const tool of form.tools ?? []) {
    const list = resolveRef(tool.ref)[
      refExportName("tool", { id: tool.id, ref: tool.ref })
    ] as readonly Tool[] | undefined;
    if (list !== undefined) tools.push(...list);
  }

  for (const wf of form.workflows) {
    const { workflow, ops, workflowTools } = compileWorkflow(wf, resolveRef);
    workflows.push(workflow);
    Object.assign(operations, ops);
    tools.push(...workflowTools);
  }

  const edges = (form.edges ?? []).map((edge) => compileEdge(edge, resolveRef));

  const actions = (form.actions ?? []).map((action) =>
    compileFlowLevelAction(action, resolveRef)
  );

  return {
    id: form.id,
    label: form.label,
    ...(form.description !== undefined
      ? { description: form.description }
      : {}),
    ...(form.configSchema !== undefined
      ? { configSchema: form.configSchema }
      : {}),
    ...(form.flowState !== undefined && form.flowState.length > 0
      ? { flowState: form.flowState }
      : {}),
    ...(form.domainDir !== undefined ? { domainDir: form.domainDir } : {}),
    ...(form.ui !== undefined ? { ui: form.ui } : {}),
    workflows,
    edges,
    ...(Object.keys(operations).length > 0 ? { operations } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ─── workflows ────────────────────────────────────────────────────────

function compileWorkflow(
  wf: FlowDefinition["workflows"][number],
  resolveRef: RefResolver
): {
  workflow: RuntimeWorkflowConfig;
  ops: Record<string, OperationFn>;
  workflowTools: Tool[];
} {
  const ops: Record<string, OperationFn> = {};
  const workflowTools: Tool[] = [];

  const states = wf.states.map((state) =>
    compileState(wf.id, state, ops, workflowTools, resolveRef)
  );

  const workflow: RuntimeWorkflowConfig = {
    id: wf.id,
    label: wf.label,
    ...(wf.description !== undefined ? { description: wf.description } : {}),
    ...(wf.instance?.title !== undefined
      ? {
          instance: {
            title: wf.instance.title,
            ...(wf.instance.subtitle !== undefined
              ? { subtitle: wf.instance.subtitle }
              : {}),
          },
        }
      : {}),
    ...(wf.ui !== undefined
      ? {
          ui: {
            ...(wf.ui.view !== undefined ? { view: wf.ui.view } : {}),
            ...(wf.ui.instanceComponent !== undefined
              ? { instanceComponent: wf.ui.instanceComponent }
              : {}),
            ...(wf.ui.columns !== undefined ? { columns: wf.ui.columns } : {}),
            ...(wf.ui.groupByField !== undefined
              ? { groupByField: wf.ui.groupByField }
              : {}),
          },
        }
      : {}),
    ...(wf.display !== undefined && wf.display.fields.length > 0
      ? {
          display: {
            fields: wf.display.fields.map((field) => ({
              path: field.path,
              ...(field.label !== undefined ? { label: field.label } : {}),
              ...(field.render !== undefined
                ? {
                    render:
                      typeof field.render === "string"
                        ? { kind: field.render }
                        : field.render,
                  }
                : {}),
              ...(field.derive !== undefined ? { derive: field.derive } : {}),
            })),
          },
        }
      : {}),
    ...(wf.editFields !== undefined && wf.editFields.length > 0
      ? { editFields: wf.editFields }
      : {}),
    // The declared instance-state fields ride on the compiled projection so
    // the runtime can validate cross-instance patches (E1) against the target
    // workflow's declaration.
    instanceState: wf.instanceState,
    taskOutputs: {},
    states,
    initial: wf.initial,
    terminalStates: wf.terminalStates,
  };

  return { workflow, ops, workflowTools };
}

function compileState(
  workflowId: string,
  state: StateSpec,
  ops: Record<string, OperationFn>,
  workflowTools: Tool[],
  resolveRef: RefResolver
): RuntimeWorkflowConfig["states"][number] {
  return {
    id: state.id,
    label: state.label,
    ...(state.description !== undefined
      ? { description: state.description }
      : {}),
    ...(state.category !== undefined ? { category: state.category } : {}),
    ...(state.tasks !== undefined && state.tasks.length > 0
      ? {
          tasks: state.tasks.map((task) =>
            compileTask(workflowId, task, ops, workflowTools, resolveRef)
          ),
        }
      : {}),
    ...(state.autoTransitions !== undefined && state.autoTransitions.length > 0
      ? {
          autoTransitions: state.autoTransitions.map((transition) => ({
            to: transition.to,
            gate: buildGate(transition.gate, resolveRef),
          })),
        }
      : {}),
    ...(state.actions !== undefined && state.actions.length > 0
      ? {
          actions: state.actions.map((action) =>
            compileAction(action, resolveRef)
          ),
        }
      : {}),
  };
}

function compileTask(
  workflowId: string,
  task: TaskSpec,
  ops: Record<string, OperationFn>,
  workflowTools: Tool[],
  resolveRef: RefResolver
): NonNullable<
  NonNullable<RuntimeWorkflowConfig["states"][number]["tasks"]>[number]
> {
  // Inline operation refs register their `<base>Operations` map into the
  // merged ops under the file base name; the task runs the op by that name.
  const operations: string[] = [];
  for (const op of task.operations ?? []) {
    if (typeof op === "string") {
      operations.push(op);
    } else {
      const name = opNameOf(op.ref);
      const map = resolveRef(op.ref)[
        refExportName("operation", { id: name, ref: op.ref })
      ] as Record<string, OperationFn> | undefined;
      if (map !== undefined) Object.assign(ops, map);
      operations.push(name);
    }
  }

  if (task.patch !== undefined) {
    const patchName = `${workflowId}_${task.id}_patch`;
    ops[patchName] = buildPatchOp(task.patch);
    operations.push(patchName);
  }
  if (task.extract !== undefined) {
    const extractName = `${workflowId}_${task.id}_extract`;
    ops[extractName] = buildExtractOp(task.extract, resolveRef);
    operations.push(extractName);
  }

  // The completion tool (declared or generated from completionOutput) is
  // always offered to the model: a task that declares a completion contract
  // but never lists the tool cannot call it, so the agent silently falls back
  // to a transcript output.
  const completionToolName = task.completionOutput
    ? `${workflowId}_${task.id}_complete`
    : task.completionTool;
  if (task.completionOutput !== undefined) {
    workflowTools.push(
      buildCompletionTool(workflowId, task.id, task, task.completionOutput)
    );
  }
  const tools = [...(task.tools ?? [])];
  if (completionToolName !== undefined && !tools.includes(completionToolName)) {
    tools.push(completionToolName);
  }

  const systemPrompt = task.systemPromptRef
    ? (resolveRef(task.systemPromptRef)[
        refExportName("prompt", { ref: task.systemPromptRef })
      ] as string | undefined)
    : task.systemPrompt;

  return {
    id: task.id,
    label: task.label ?? task.id,
    trigger: "auto",
    role: task.role,
    ...(operations.length > 0 ? { operations } : {}),
    ...(task.operationInputs !== undefined
      ? { operationInputs: task.operationInputs }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(completionToolName !== undefined
      ? { completionTool: completionToolName }
      : {}),
    ...(task.completionSignal !== undefined
      ? { completionSignal: task.completionSignal }
      : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(task.startOnUserInput === true ? { startOnUserInput: true } : {}),
    ...(task.workspacePath !== undefined
      ? { workspacePath: task.workspacePath }
      : {}),
    ...(task.inputFromInstanceState !== undefined
      ? { inputFromInstanceState: task.inputFromInstanceState }
      : {}),
    ...(task.persist !== undefined ? { persist: task.persist } : {}),
    // The data form's render kind is open (custom kinds declared in ui.kinds);
    // the runtime hint type is closed to the builtin kinds plus a custom-kind
    // generic. The compiled projection erases the open kind here — the same
    // erasure boundary defineWorkflow crosses for the workflow generics.
    ...(task.render !== undefined
      ? { render: task.render as StateTaskDef["render"] }
      : {}),
  };
}

function compileAction(
  action: ActionSpec,
  resolveRef: RefResolver
): NonNullable<
  NonNullable<RuntimeWorkflowConfig["states"][number]["actions"]>[number]
> {
  // A deletesInstance action (E5) has no transition target — dispatching it
  // removes the instance. Every other state action must declare one.
  if (action.transitionTo === undefined && action.deletesInstance !== true) {
    throw new Error(
      `state action "${action.id}" must declare transitionTo or deletesInstance (every state action either moves the acting instance or removes it)`
    );
  }
  return {
    id: action.id,
    label: action.label,
    ...(action.variant !== undefined ? { variant: action.variant } : {}),
    ...(action.confirmText !== undefined
      ? { confirmText: action.confirmText }
      : {}),
    ...(action.gate !== undefined
      ? { gate: buildGate(action.gate, resolveRef) }
      : {}),
    ...(action.maxWorkflowInstancesInTarget !== undefined
      ? { maxWorkflowInstancesInTarget: action.maxWorkflowInstancesInTarget }
      : {}),
    ...(action.dependsOnState !== undefined
      ? { dependsOnState: action.dependsOnState }
      : {}),
    ...(action.newAttempt === true ? { newAttempt: true } : {}),
    ...(action.deletesInstance === true ? { deletesInstance: true } : {}),
    ...(action.completesRunningTask === true
      ? { completesRunningTask: true }
      : {}),
    ...(action.createInstance !== undefined
      ? {
          createInstance: {
            workflowId: action.createInstance.workflowId,
            ...(action.createInstance.fields !== undefined &&
            action.createInstance.fields.length > 0
              ? { fields: action.createInstance.fields }
              : {}),
          },
        }
      : {}),
    ...(action.fields !== undefined && action.fields.length > 0
      ? { fields: action.fields }
      : {}),
    ...(action.transitionTo !== undefined
      ? { transitionTo: action.transitionTo }
      : {}),
  };
}

function compileFlowLevelAction(
  action: NonNullable<FlowDefinition["actions"]>[number],
  resolveRef: RefResolver
): FlowLevelAction {
  return {
    id: action.id,
    label: action.label,
    ...(action.variant !== undefined ? { variant: action.variant } : {}),
    ...(action.gate !== undefined
      ? { gate: buildGate(action.gate, resolveRef) }
      : {}),
    ...(action.createInstance !== undefined
      ? {
          createInstance: {
            workflowId: action.createInstance.workflowId,
            ...(action.createInstance.fields !== undefined &&
            action.createInstance.fields.length > 0
              ? { fields: action.createInstance.fields }
              : {}),
          },
        }
      : {}),
    ...(action.dispatchToAll !== undefined
      ? { dispatchToAll: action.dispatchToAll }
      : {}),
  };
}

// ─── edges ────────────────────────────────────────────────────────────

function compileEdge(edge: EdgeSpec, resolveRef: RefResolver): RuntimeFlowEdge {
  const base: RuntimeFlowEdge = {
    fromWorkflow: edge.fromWorkflow,
    fromStates: edge.fromStates,
    ...(edge.toWorkflow !== undefined ? { toWorkflow: edge.toWorkflow } : {}),
    ...(edge.toFlowState === true ? { toFlowState: true } : {}),
  };
  const hasTransform =
    Object.keys(edge.fields ?? {}).length > 0 ||
    edge.fanOut !== undefined ||
    edge.transform !== undefined;
  return hasTransform
    ? { ...base, transform: buildEdgeTransform(edge, resolveRef) }
    : base;
}

// The four transform shapes as functions: declared fields, fan-out over a
// task output array, a referenced transform module, and the pure signal (a
// field-less edge — create/merge without data).
function buildEdgeTransform(
  edge: EdgeSpec,
  resolveRef: RefResolver
): NonNullable<FlowEdge["transform"]> {
  if (edge.transform !== undefined) {
    const transform = resolveRef(edge.transform.ref)[
      refExportName("transform", { ref: edge.transform.ref })
    ] as TransformContract;
    const fields = edge.transform.fields;
    return (source) => {
      const out = transform(source);
      return (Array.isArray(out) ? out : [out]).map((row) => {
        const result: Record<string, unknown> = {};
        for (const field of fields) result[field] = row[field];
        return result;
      });
    };
  }
  if (edge.fanOut !== undefined) {
    const fan = edge.fanOut;
    return (source) => {
      const items =
        (readPath(source[fan.task], fan.path) as
          | Array<Record<string, unknown>>
          | undefined) ?? [];
      return items.map((item) => {
        const result: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(fan.fields)) {
          result[field] = fanOutValue(value, item);
        }
        return result;
      });
    };
  }
  const fields = edge.fields ?? {};
  if (Object.keys(fields).length === 0) {
    // A field-less edge is a pure signal; its transform takes no parameter so
    // the unused-param lint stays quiet.
    return () => ({});
  }
  return (source) => {
    const result: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      result[field] = edgeValue(value, source);
    }
    return result;
  };
}

function fanOutValue(
  value: NonNullable<EdgeSpec["fanOut"]>["fields"][string],
  item: Record<string, unknown>
): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "instanceId":
      return undefined; // no instance id exists at edge time
    case "itemPath":
      return value.path === "" ? item : readPath(item, value.path);
  }
}

function edgeValue(value: ValueSpec, source: Record<string, unknown>): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "instanceId":
      return undefined; // no instance id exists at edge time
    case "taskOutput":
      return readPath(source[value.task], value.path);
  }
}

// ─── gates (structured GateSpec → closure) ────────────────────────────

export function buildGate(
  gate: GateSpec,
  resolveRef: RefResolver
): (ctx: RuntimeGateContext) => boolean {
  switch (gate.kind) {
    case "always":
      return () => true;
    case "never":
      return () => false;
    case "hasRunningTask":
      return (ctx) => ctx.hasRunningTask;
    case "noRunningTask":
      return (ctx) => !ctx.hasRunningTask;
    case "taskSuccess":
      return (ctx) => ctx.taskOutputs[gate.task]?.status === "success";
    case "taskError":
      return (ctx) => ctx.taskOutputs[gate.task]?.status === "error";
    case "taskOutputEquals":
      return (ctx) =>
        readPath(ctx.taskOutputs[gate.task], gate.path) === gate.value;
    case "instanceStateEquals":
      return (ctx) =>
        readPath(ctx.workflowInstanceState, gate.field) === gate.value;
    case "errorCountAtLeast":
      return (ctx) => (ctx.taskErrorCounts[gate.task] ?? 0) >= gate.count;
    case "file": {
      const fn = resolveRef(gate.ref)[
        refExportName("gate", { ref: gate.ref })
      ] as (ctx: RuntimeGateContext) => boolean;
      return (ctx) => fn(ctx);
    }
    case "not": {
      const inner = buildGate(gate.gate, resolveRef);
      return (ctx) => !inner(ctx);
    }
    case "and": {
      const gates = gate.gates.map((g) => buildGate(g, resolveRef));
      return (ctx) => gates.every((g) => g(ctx));
    }
    case "or": {
      const gates = gate.gates.map((g) => buildGate(g, resolveRef));
      return (ctx) => gates.some((g) => g(ctx));
    }
  }
}

// ─── generated per-workflow machinery ─────────────────────────────────

// A patch op reads its ValueSpecs, guards undefined (a sourced write that
// resolves to undefined is a contract failure — the source task did not
// produce the declared output), and patches instance state. The op throws so
// taskError gates route the instance to a retry/needs-review state instead of
// silently recording an empty write as success.
function buildPatchOp(patch: Record<string, ValueSpec>): OperationFn {
  const sourcedFields = Object.entries(patch).filter(
    (entry): entry is [string, Extract<ValueSpec, { kind: "taskOutput" }>] =>
      entry[1].kind === "taskOutput"
  );
  const sourceTasks = [
    ...new Set(sourcedFields.map(([, value]) => value.task)),
  ];
  const missingFields = sourcedFields.map(([field]) => field);
  return (_task, _params, ctx) => {
    const sourced: Record<string, unknown> = {};
    for (const [field, value] of sourcedFields) {
      sourced[field] = readPath(ctx.taskOutputs()[value.task], value.path);
    }
    if (sourcedFields.some(([field]) => sourced[field] === undefined)) {
      throw new Error(
        `${sourceTasks.join(", ")} did not produce the declared output (${missingFields.join(", ")})`
      );
    }
    const write: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(patch)) {
      write[field] = patchValue(value, sourced[field], ctx.instanceId);
    }
    ctx.patchWorkflowInstanceState(write);
    return { ok: true };
  };
}

function patchValue(
  value: ValueSpec,
  sourced: unknown,
  instanceId: string
): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "instanceId":
      return instanceId;
    case "taskOutput":
      return sourced;
  }
}

// An extract op runs the referenced extractor over the instance's task
// outputs and patches the declared fields into instance state.
function buildExtractOp(
  extract: NonNullable<TaskSpec["extract"]>,
  resolveRef: RefResolver
): OperationFn {
  const extractor = resolveRef(extract.ref)[
    refExportName("extract", { ref: extract.ref })
  ] as OutputExtractor;
  return (_task, _params, ctx) => {
    const extracted = extractor({
      taskOutputs: ctx.taskOutputs(),
      workflowInstanceState: () => ctx.workflowInstanceState(),
    });
    const write: Record<string, unknown> = {};
    for (const field of extract.fields) write[field] = extracted[field];
    ctx.patchWorkflowInstanceState(write);
    return { ok: true };
  };
}

// A structured completion contract → the generated completion tool (name,
// description, JSON schema, executor). Added to the workflow's tools and
// offered to the model; the parsed arguments become the task output.
function buildCompletionTool(
  workflowId: string,
  taskId: string,
  task: TaskSpec,
  fields: CompletionOutputField[]
): Tool {
  const name = `${workflowId}_${taskId}_complete`;
  const properties: Record<
    string,
    { type: string; items?: { type: string }; description?: string }
  > = {};
  for (const field of fields) {
    const schema: {
      type: string;
      items?: { type: string };
      description?: string;
    } = {
      type: schemaType(field.type),
    };
    if (field.type.endsWith("[]")) {
      schema.items = { type: field.type.slice(0, -2) };
    }
    if (field.description !== undefined) schema.description = field.description;
    properties[field.field] = schema;
  }
  return defineTool({
    name,
    description: `Complete the ${task.label ?? task.id} task, returning the declared fields: ${fields
      .map((f) => `${f.field} (${f.type})`)
      .join(", ")}.`,
    parameters: {
      properties,
      required: fields.map((f) => f.field),
    },
    executor: (call) => ({
      toolCallId: call.id,
      content: "Task completed",
      isError: false,
    }),
  });
}

// The JSON-schema type a completion tool parameter derives from a FieldType
// (array kinds carry their item type in `items`).
function schemaType(type: FieldType): string {
  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "object":
      return type;
    case "string[]":
    case "number[]":
    case "boolean[]":
    case "object[]":
      return "array";
    default:
      return "string";
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

// Resolves a dotted path into an object, returning undefined for missing
// segments. Mirrors the renderer's readPath emission and the runtime's own
// resolver — the generated ops read task outcomes through it.
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
