/** @private — the renderer: FlowBlueprint → the module set: the definition
 * entry wiring blueprint-referenced modules via imports, plus one
 * contract-typed stub per reference. */

import type { FieldType } from "../flow-blueprint.ts";
import {
  collectModuleReferences,
  type FlowBlueprint,
  type ModuleReference,
  opNameOf,
} from "../flow-blueprint.ts";
import { renderConfigFields } from "./config-field.ts";
import {
  buildOutputNode,
  collectOutputPaths,
  renderOutputNode,
} from "./output-type.ts";
import { renderGate } from "./render-gate.ts";
import {
  castTo,
  fieldType,
  json,
  pascal,
  schemaType,
} from "./render-primitives.ts";
import { renderEdgeValue, renderPatchValue } from "./render-value.ts";
import { renderReferenceStubs } from "./stubs.ts";

export type RenderedModuleSet = {
  // The definition module (flow.ts): the workflows, edges, and capabilities
  // with every reference wired via an import.
  entry: string;
  // The referenced modules: relative ref path → stub source (one per unique
  // ref; an existing file is authoritative and wins on materialization).
  files: Record<string, string>;
};

export function renderFlowDefinition(
  blueprint: FlowBlueprint
): RenderedModuleSet {
  const out: string[] = [];
  const emit = (level: number, text: string) =>
    out.push("  ".repeat(level) + text);

  // ── blueprint-referenced modules ──
  // The normalized reference inventory drives the imports and wiring; the
  // same inventory feeds the stub generator and the module-set lint, so the
  // three never drift.
  const refs = collectModuleReferences(blueprint);
  const bindingByRef = buildBindings(refs);
  const fileGateBinding = (ref: string) => bindingByRef.get(ref) ?? ref;

  const hasPatchOps = blueprint.workflows.some((wf) =>
    wf.states.some((s) => (s.tasks ?? []).some((t) => t.patch !== undefined))
  );
  const hasExtractOps = blueprint.workflows.some((wf) =>
    wf.states.some((s) => (s.tasks ?? []).some((t) => t.extract !== undefined))
  );
  const hasCompletionOutput = blueprint.workflows.some((wf) =>
    wf.states.some((s) =>
      (s.tasks ?? []).some((t) => t.completionOutput !== undefined)
    )
  );
  const needsReadPath = (() => {
    for (const wf of blueprint.workflows) {
      for (const state of wf.states) {
        for (const task of state.tasks ?? []) {
          if (
            task.patch &&
            Object.values(task.patch).some((v) => v.kind === "taskOutput")
          ) {
            return true;
          }
        }
      }
    }
    for (const edge of blueprint.edges ?? []) {
      if (
        (edge.fields &&
          Object.values(edge.fields).some((v) => v.kind === "taskOutput")) ||
        edge.fanOut
      ) {
        return true;
      }
    }
    return false;
  })();

  emit(
    0,
    `import { defineWorkflow, type FlowDefinition, type FlowEdge } from "workflow-engine/workflow-types";`
  );
  if (hasPatchOps || hasExtractOps || hasCompletionOutput)
    emit(
      0,
      `import { ${[
        (hasPatchOps || hasExtractOps) && "defineOperations",
        hasCompletionOutput && "defineTool",
      ]
        .filter(Boolean)
        .join(", ")} } from "workflow-engine/runners";`
    );
  for (const line of buildImportLines(refs, bindingByRef)) emit(0, line);
  emit(0, "");
  if (needsReadPath) {
    emit(0, "function readPath(value: unknown, path: string): unknown {");
    emit(1, "let current: unknown = value;");
    emit(1, 'for (const segment of path.split(".")) {');
    emit(2, "if (current === null || current === undefined) return undefined;");
    emit(2, 'if (typeof current !== "object") return undefined;');
    emit(2, "current = (current as Record<string, unknown>)[segment];");
    emit(1, "}");
    emit(1, "return current;");
    emit(0, "}");
    emit(0, "");
  }

  const outputPathsByWorkflow = new Map<
    string,
    Map<string, { rest: string; type: string }[]>
  >();
  for (const wf of blueprint.workflows) {
    const byTask = collectOutputPaths(blueprint);
    const perWorkflow = new Map<string, { rest: string; type: string }[]>();
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        perWorkflow.set(task.id, byTask.get(task.id) ?? []);
      }
    }
    outputPathsByWorkflow.set(wf.id, perWorkflow);
  }

  const workflowNames: string[] = [];
  for (const wf of blueprint.workflows) {
    workflowNames.push(`${wf.id}Wf`);
    const p = pascal(wf.id);
    const typeName = `${p}ItemState`;
    const tasks = wf.states.flatMap((s) => s.tasks ?? []);
    const taskOutputPaths =
      outputPathsByWorkflow.get(wf.id) ??
      new Map<string, { rest: string; type: string }[]>();

    // ── instance state type ──
    if (wf.instanceState.length > 0) {
      emit(0, `type ${typeName} = {`);
      for (const field of wf.instanceState) {
        emit(1, `${field.field}?: ${fieldType(field.type)};`);
      }
      emit(0, "};");
      emit(0, "");
    }

    // ── task outputs type ──
    if (tasks.length > 0) {
      emit(0, `type ${p}TaskOutputs = {`);
      for (const task of tasks) {
        // A structured completion contract types the task's output from the
        // declared fields: an ai-task's output IS the parsed completion
        // arguments; an ai-chat wraps them next to the transcript as
        // `completion`, so gates read output.completion.<field>.
        const outputType = task.completionOutput
          ? task.role === "ai-chat"
            ? `{ content?: string; completion?: { ${task.completionOutput
                .map((f) => `${f.field}?: ${fieldType(f.type)};`)
                .join(" ")} } }`
            : `{ ${task.completionOutput
                .map((f) => `${f.field}?: ${fieldType(f.type)};`)
                .join(" ")} }`
          : renderOutputNode(
              buildOutputNode(taskOutputPaths.get(task.id) ?? [])
            );
        emit(1, `${task.id}?: ${outputType};`);
      }
      emit(0, "};");
      emit(0, "");
    }

    // ── ops map (only when patch/extract ops are declared) ──
    const patchTasks = tasks.filter((t) => t.patch !== undefined);
    const extractTasks = tasks.filter((t) => t.extract !== undefined);
    if (patchTasks.length > 0 || extractTasks.length > 0) {
      const stateType =
        wf.instanceState.length > 0 ? typeName : "Record<string, unknown>";
      emit(
        0,
        `export const ${wf.id}Operations = defineOperations<${stateType}>({`
      );
      for (const task of patchTasks) {
        const patch = task.patch ?? {};
        // A sourced write that resolves to undefined is a contract failure —
        // the source task did not produce the declared output. The op throws
        // so taskError gates route the instance to a retry/needs-review state
        // instead of silently recording an empty write as success.
        const sourcedFields = Object.entries(patch).filter(
          ([, value]) => value.kind === "taskOutput"
        );
        emit(1, `${wf.id}_${task.id}_patch: (task, params, ctx) => {`);
        if (sourcedFields.length > 0) {
          for (const [field, value] of sourcedFields) {
            const fieldDecl = wf.instanceState.find((f) => f.field === field);
            const type: FieldType = fieldDecl?.type ?? "object";
            emit(2, `const ${field} = ${renderPatchValue(value, type)};`);
          }
          emit(
            2,
            `if (${sourcedFields
              .map(([field]) => `${field} === undefined`)
              .join(" || ")}) {`
          );
          emit(
            3,
            `throw new Error("${[
              ...new Set(
                sourcedFields.map(
                  ([, value]) => (value as { task?: string }).task ?? ""
                )
              ),
            ].join(", ")} did not produce the declared output (${sourcedFields
              .map(([field]) => field)
              .join(", ")})");`
          );
          emit(2, "}");
        }
        emit(2, "ctx.patchWorkflowInstanceState({");
        for (const [field, value] of Object.entries(patch)) {
          const fieldDecl = wf.instanceState.find((f) => f.field === field);
          const type: FieldType = fieldDecl?.type ?? "object";
          // Sourced values reference the hoisted consts; literal/instanceId
          // values are emitted inline.
          const expr =
            value.kind === "taskOutput" ? field : renderPatchValue(value, type);
          emit(3, `${field}: ${expr},`);
        }
        emit(2, "});");
        emit(2, "return { ok: true };");
        emit(1, "},");
      }
      for (const task of extractTasks) {
        const extract = task.extract ?? { ref: "", fields: [] };
        const binding = bindingByRef.get(extract.ref) ?? extract.ref;
        emit(1, `${wf.id}_${task.id}_extract: (task, params, ctx) => {`);
        emit(2, `const extracted = ${binding}({`);
        emit(3, "taskOutputs: ctx.taskOutputs(),");
        emit(3, "workflowInstanceState: ctx.workflowInstanceState,");
        emit(2, "});");
        emit(2, "ctx.patchWorkflowInstanceState({");
        for (const field of extract.fields) {
          const fieldDecl = wf.instanceState.find((f) => f.field === field);
          const type: FieldType = fieldDecl?.type ?? "object";
          emit(
            3,
            `${field}: extracted.${field} as ${fieldType(type)} | undefined,`
          );
        }
        emit(2, "});");
        emit(2, "return { ok: true };");
        emit(1, "},");
      }
      emit(0, "});");
      emit(0, "");
    }

    // ── structured completion tools (only when completionOutput is declared) ──
    const completionTasks = tasks.filter(
      (t) => t.completionOutput !== undefined
    );
    if (completionTasks.length > 0) {
      emit(0, `export const ${wf.id}CompletionTools = [`);
      for (const task of completionTasks) {
        const fields = task.completionOutput ?? [];
        const toolName = `${wf.id}_${task.id}_complete`;
        const properties = fields
          .map((f) => {
            const parts = [`type: ${json(schemaType(f.type))}`];
            if (f.type.endsWith("[]")) {
              parts.push(`items: { type: ${json(f.type.slice(0, -2))} }`);
            }
            if (f.description)
              parts.push(`description: ${json(f.description)}`);
            return `${f.field}: { ${parts.join(", ")} }`;
          })
          .join(", ");
        emit(1, "defineTool({");
        emit(2, `name: ${json(toolName)},`);
        emit(
          2,
          `description: ${json(
            `Complete the ${task.label ?? task.id} task, returning the declared fields: ${fields
              .map((f) => `${f.field} (${f.type})`)
              .join(", ")}.`
          )},`
        );
        emit(2, "parameters: {");
        emit(3, `properties: { ${properties} },`);
        emit(3, `required: [${fields.map((f) => json(f.field)).join(", ")}],`);
        emit(2, "},");
        emit(
          2,
          'executor: (call) => ({ toolCallId: call.id, content: "Task completed", isError: false }),'
        );
        emit(1, "}),");
      }
      emit(0, "];");
      emit(0, "");
    }

    // ── the workflow ──
    emit(0, `const ${wf.id}Wf = defineWorkflow({`);
    emit(1, `id: ${json(wf.id)},`);
    emit(1, `label: ${json(wf.label)},`);
    if (wf.description) emit(1, `description: ${json(wf.description)},`);
    if (wf.instance?.title) {
      const parts = [`title: ${json(wf.instance.title)}`];
      if (wf.instance.subtitle)
        parts.push(`subtitle: ${json(wf.instance.subtitle)}`);
      emit(1, `instance: { ${parts.join(", ")} },`);
    }
    if (wf.ui) {
      const parts: string[] = [];
      if (wf.ui.view) parts.push(`view: ${json(wf.ui.view)}`);
      if (wf.ui.instanceComponent)
        parts.push(`instanceComponent: ${json(wf.ui.instanceComponent)}`);
      if (wf.ui.columns) {
        const columns = wf.ui.columns
          .map(
            (c) =>
              `{ id: ${json(c.id)}, label: ${json(c.label)}, states: [${c.states.map(json).join(", ")}] }`
          )
          .join(", ");
        parts.push(`columns: [${columns}]`);
      }
      if (parts.length > 0) emit(1, `ui: { ${parts.join(", ")} },`);
    }
    if (wf.display?.fields.length) {
      const fields = wf.display.fields
        .map((f) => {
          const parts = [`path: ${json(f.path)}`];
          if (f.label) parts.push(`label: ${json(f.label)}`);
          if (f.render) parts.push(`render: ${renderHintSource(f.render)}`);
          if (f.derive) parts.push(`derive: ${JSON.stringify(f.derive)}`);
          return `{ ${parts.join(", ")} }`;
        })
        .join(", ");
      emit(1, `display: { fields: [${fields}] },`);
    }
    if (wf.editFields !== undefined && wf.editFields.length > 0) {
      emit(1, `editFields: [${renderConfigFields(wf.editFields)}],`);
    }
    if (tasks.length > 0) {
      emit(1, `taskOutputs: {} as ${p}TaskOutputs,`);
    } else {
      emit(1, `taskOutputs: {} as Record<string, never>,`);
    }
    if (wf.instanceState.length > 0) {
      emit(1, `workflowInstanceState: {} as ${typeName},`);
    } else {
      emit(1, `workflowInstanceState: {} as Record<string, unknown>,`);
    }
    emit(1, "states: [");
    for (const state of wf.states) {
      emit(2, "{");
      emit(3, `id: ${json(state.id)},`);
      emit(3, `label: ${json(state.label)},`);
      if (state.category) emit(3, `category: ${json(state.category)},`);
      if (state.tasks && state.tasks.length > 0) {
        emit(3, "tasks: [");
        for (const task of state.tasks) {
          emit(4, "{");
          emit(5, `id: ${json(task.id)},`);
          emit(5, `label: ${json(task.label ?? task.id)},`);
          emit(5, 'trigger: "auto",');
          emit(5, `role: ${json(task.role)},`);
          const taskOps = (task.operations ?? []).map((op) =>
            typeof op === "string" ? op : opNameOf(op.ref)
          );
          if (task.patch) taskOps.push(`${wf.id}_${task.id}_patch`);
          if (task.extract) taskOps.push(`${wf.id}_${task.id}_extract`);
          if (taskOps.length > 0) {
            emit(5, `operations: [${taskOps.map(json).join(", ")}],`);
          }
          if (
            task.operationInputs &&
            Object.keys(task.operationInputs).length > 0
          ) {
            emit(
              5,
              `operationInputs: ${JSON.stringify(task.operationInputs)},`
            );
          }
          // The completion tool (declared or generated from completionOutput)
          // is always offered to the model: a task that declares a completion
          // contract but never lists the tool cannot call it, so the agent
          // silently falls back to a transcript output.
          const completionToolName = task.completionOutput
            ? `${wf.id}_${task.id}_complete`
            : task.completionTool;
          const tools = [...(task.tools ?? [])];
          if (completionToolName && !tools.includes(completionToolName)) {
            tools.push(completionToolName);
          }
          if (tools.length > 0) {
            emit(5, `tools: [${tools.map(json).join(", ")}],`);
          }
          if (completionToolName)
            emit(5, `completionTool: ${json(completionToolName)},`);
          if (task.completionSignal)
            emit(5, `completionSignal: ${json(task.completionSignal)},`);
          if (task.systemPromptRef) {
            // A referenced prompt: the entry imports the prompt const and the
            // task references the binding (the camel-cased file base name).
            emit(5, `systemPrompt: ${fileGateBinding(task.systemPromptRef)},`);
          } else if (task.systemPrompt) {
            emit(5, `systemPrompt: ${json(task.systemPrompt)},`);
          }
          if (task.startOnUserInput) emit(5, "startOnUserInput: true,");
          if (task.workspacePath)
            emit(5, `workspacePath: ${json(task.workspacePath)},`);
          if (task.inputFromInstanceState) {
            emit(
              5,
              `inputFromInstanceState: ${json(task.inputFromInstanceState)},`
            );
          }
          if (task.persist)
            emit(5, `persist: { path: ${json(task.persist.path)} },`);
          emit(4, "},");
        }
        emit(3, "],");
      }
      if (state.autoTransitions && state.autoTransitions.length > 0) {
        emit(3, "autoTransitions: [");
        for (const transition of state.autoTransitions) {
          emit(4, "{");
          emit(5, `to: ${json(transition.to)},`);
          emit(
            5,
            `gate: (ctx) => ${renderGate(transition.gate, fileGateBinding)},`
          );
          emit(4, "},");
        }
        emit(3, "],");
      }
      if (state.actions && state.actions.length > 0) {
        emit(3, "actions: [");
        for (const action of state.actions) {
          emit(4, "{");
          emit(5, `id: ${json(action.id)},`);
          emit(5, `label: ${json(action.label)},`);
          if (action.variant) emit(5, `variant: ${json(action.variant)},`);
          if (action.confirmText)
            emit(5, `confirmText: ${json(action.confirmText)},`);
          if (action.gate)
            emit(
              5,
              `gate: (ctx) => ${renderGate(action.gate, fileGateBinding)},`
            );
          if (action.maxWorkflowInstancesInTarget !== undefined) {
            emit(
              5,
              `maxWorkflowInstancesInTarget: ${action.maxWorkflowInstancesInTarget},`
            );
          }
          if (action.dependsOnState)
            emit(5, `dependsOnState: ${json(action.dependsOnState)},`);
          if (action.newAttempt) emit(5, "newAttempt: true,");
          if (action.completesRunningTask)
            emit(5, "completesRunningTask: true,");
          if (action.createInstance) {
            emit(
              5,
              `createInstance: { workflowId: ${json(action.createInstance.workflowId)}, fields: [${renderConfigFields(action.createInstance.fields)}] },`
            );
          }
          if (action.fields && action.fields.length > 0) {
            emit(5, `fields: [${renderConfigFields(action.fields)}],`);
          }
          if (action.transitionTo)
            emit(5, `transitionTo: ${json(action.transitionTo)},`);
          emit(4, "},");
        }
        emit(3, "],");
      }
      emit(2, "},");
    }
    emit(1, "],");
    emit(1, `initial: ${json(wf.initialState)},`);
    emit(1, `terminalStates: [${wf.terminalStates.map(json).join(", ")}],`);
    emit(0, "});");
    emit(0, "");
  }

  // ── the flow ──
  emit(0, "export const flow = {");
  emit(1, `id: ${json(blueprint.id)},`);
  emit(1, `label: ${json(blueprint.label)},`);
  if (blueprint.description)
    emit(1, `description: ${json(blueprint.description)},`);
  emit(1, `configSchema: [${renderConfigFields(blueprint.configSchema)}],`);
  if (blueprint.domainDir) emit(1, `domainDir: ${json(blueprint.domainDir)},`);
  if (blueprint.ui?.components) {
    const components = Object.entries(blueprint.ui.components)
      .map(([componentId, source]) => `${json(componentId)}: ${json(source)}`)
      .join(", ");
    emit(1, `ui: { components: { ${components} } },`);
  }
  emit(1, `workflows: [${workflowNames.join(", ")}],`);
  // The operations map merges the referenced op maps (flow-level ops first,
  // then inline task refs) and the per-workflow patch/extract maps.
  const operationRefs = refs.filter(
    (r): r is ModuleReference & { kind: "operation" } => r.kind === "operation"
  );
  const opRefBindings = [
    ...operationRefs.filter((r) => r.path.startsWith("operations[")),
    ...operationRefs.filter((r) => !r.path.startsWith("operations[")),
  ].map((r) => bindingByRef.get(r.ref) ?? r.ref);
  const workflowOpMapNames = blueprint.workflows
    .filter((wf) =>
      wf.states.some((s) =>
        (s.tasks ?? []).some(
          (t) => t.patch !== undefined || t.extract !== undefined
        )
      )
    )
    .map((wf) => `${wf.id}Operations`);
  const opMapNames = [...opRefBindings, ...workflowOpMapNames];
  if (opMapNames.length > 0) {
    emit(1, `operations: { ${opMapNames.map((n) => `...${n}`).join(", ")} },`);
  }
  const completionToolMapNames = blueprint.workflows
    .filter((wf) =>
      wf.states.some((s) =>
        (s.tasks ?? []).some((t) => t.completionOutput !== undefined)
      )
    )
    .map((wf) => `${wf.id}CompletionTools`);
  const toolListNames = refs
    .filter((r) => r.kind === "tool")
    .map((r) => bindingByRef.get(r.ref) ?? r.ref);
  const tools = [...toolListNames, ...completionToolMapNames];
  if (tools.length > 0) {
    emit(1, `tools: [${tools.map((n) => `...${n}`).join(", ")}],`);
  }
  if (blueprint.actions && blueprint.actions.length > 0) {
    emit(1, "actions: [");
    for (const action of blueprint.actions) {
      emit(2, "{");
      emit(3, `id: ${json(action.id)},`);
      emit(3, `label: ${json(action.label)},`);
      if (action.variant) emit(3, `variant: ${json(action.variant)},`);
      if (action.gate)
        emit(3, `gate: (ctx) => ${renderGate(action.gate, fileGateBinding)},`);
      if (action.createInstance) {
        emit(
          3,
          `createInstance: { workflowId: ${json(action.createInstance.workflowId)}, fields: [${renderConfigFields(action.createInstance.fields)}] },`
        );
      }
      if (action.dispatchToAll) {
        emit(
          3,
          `dispatchToAll: { workflowId: ${json(action.dispatchToAll.workflowId)}, actionId: ${json(action.dispatchToAll.actionId)} },`
        );
      }
      emit(2, "},");
    }
    emit(1, "],");
  }
  emit(1, "edges: [");
  for (const edge of blueprint.edges ?? []) {
    emit(2, "{");
    emit(3, `fromWorkflow: ${json(edge.fromWorkflow)},`);
    emit(3, `fromStates: [${edge.fromStates.map(json).join(", ")}],`);
    emit(3, `toWorkflow: ${json(edge.toWorkflow)},`);
    if (edge.transform) {
      // The referenced transform is wrapped so its writes stay visible to the
      // schema-consistency check (literal keys) and the erased FlowEdge type
      // (arrays mean fan-out — a single object is normalized to a one-item
      // array).
      const binding =
        bindingByRef.get(edge.transform.ref) ?? edge.transform.ref;
      emit(3, "transform: (source) => {");
      emit(4, `const out = ${binding}(source);`);
      emit(4, "return (Array.isArray(out) ? out : [out]).map((row) => ({");
      for (const field of edge.transform.fields) {
        const fieldDecl = blueprint.workflows
          .find((w) => w.id === edge.toWorkflow)
          ?.instanceState.find((f) => f.field === field);
        const type: FieldType = fieldDecl?.type ?? "object";
        emit(5, `${field}: row.${field} as ${fieldType(type)} | undefined,`);
      }
      emit(4, "}));");
      emit(3, "},");
    } else if (edge.fanOut) {
      const fan = edge.fanOut;
      emit(3, "transform: (source) => {");
      emit(
        4,
        `const items = readPath(source.${fan.task}, ${json(fan.path)}) as Array<Record<string, unknown>> | undefined ?? [];`
      );
      emit(4, "return items.map((item) => ({");
      for (const [field, value] of Object.entries(fan.fields)) {
        const fieldDecl = blueprint.workflows
          .find((w) => w.id === edge.toWorkflow)
          ?.instanceState.find((f) => f.field === field);
        const type: FieldType = fieldDecl?.type ?? "object";
        const expr =
          value.kind === "literal"
            ? json(value.value)
            : value.kind === "instanceId"
              ? "undefined"
              : value.path === ""
                ? `item ${castTo(type)}`
                : `readPath(item, ${json(value.path)}) ${castTo(type)}`;
        emit(5, `${field}: ${expr},`);
      }
      emit(4, "}));");
      emit(3, "},");
    } else {
      const fields = edge.fields ?? {};
      emit(3, "transform: (source) => ({");
      for (const [field, value] of Object.entries(fields)) {
        const fieldDecl = blueprint.workflows
          .find((w) => w.id === edge.toWorkflow)
          ?.instanceState.find((f) => f.field === field);
        const type: FieldType = fieldDecl?.type ?? "object";
        emit(4, `${field}: ${renderEdgeValue(value, type)},`);
      }
      emit(3, "}),");
    }
    emit(2, "} satisfies FlowEdge,");
  }
  emit(1, "],");
  emit(0, "} satisfies FlowDefinition;");

  return {
    entry: `${out.join("\n")}\n`,
    files: renderReferenceStubs(blueprint),
  };
}

// ── reference imports ────────────────────────────────────────────────

// Maps each unique referenced module to the import binding the entry uses.
// Bindings are the stub export names; a collision (two files deriving the
// same name) is disambiguated with a numeric suffix.
function buildBindings(refs: ModuleReference[]): Map<string, string> {
  const used = new Set<string>();
  const byRef = new Map<string, string>();
  for (const ref of refs) {
    if (byRef.has(ref.ref)) continue;
    let binding = ref.exportName;
    let n = 2;
    while (used.has(binding)) binding = `${ref.exportName}_${n++}`;
    used.add(binding);
    byRef.set(ref.ref, binding);
  }
  return byRef;
}

// The emitted render hint: a bare string is the blueprint's kind shorthand
// for a prop-less render ({ kind: <string> }) — normalize it to the object
// shape the definition type (RuntimeRenderHint) expects.
function renderHintSource(render: unknown): string {
  const hint = typeof render === "string" ? { kind: render } : render;
  return JSON.stringify(hint);
}

// One import line per unique module, in first-use order.
function buildImportLines(
  refs: ModuleReference[],
  bindingByRef: Map<string, string>
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    const binding = bindingByRef.get(ref.ref) ?? ref.ref;
    lines.push(
      binding === ref.exportName
        ? `import { ${binding} } from "${ref.ref}";`
        : `import { ${ref.exportName} as ${binding} } from "${ref.ref}";`
    );
  }
  return lines;
}
