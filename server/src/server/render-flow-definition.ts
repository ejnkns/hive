/** @public — the deterministic renderer: FlowSpec → TypeScript flow definition.
 *
 * This is the convention-enforcing core of AI flow authoring. Instead of
 * asking a model to remember the schema-consistency check's conventions
 * (anchors, defineOperations maps, patchWorkflowInstanceState writes,
 * FlowEdge transforms, ctx.workflowInstanceState reads), the renderer emits
 * them *structurally* from a validated spec — so a rendered definition is
 * correct by construction and the check's errors, when they appear, are
 * real semantic errors, not convention drift.
 *
 * Conventions baked in:
 *   - `workflowInstanceState: {} as <Wf>ItemState` anchors, with the type
 *     alias derived from the spec's instanceState declaration;
 *   - ops emitted as exported `const <wfId>Operations = defineOperations<...>`
 *     maps (the check resolves ops through these), patch writes via
 *     `ctx.patchWorkflowInstanceState({ ... })` literals;
 *   - gates rendered as `(ctx) => ...` closures over
 *     `ctx.taskOutputs.<task>?.output?....` (optional chaining) and
 *     `ctx.workflowInstanceState.<field>`;
 *   - edges as `{ ... } satisfies FlowEdge` with transforms returning the
 *     mapped object literal;
 *   - `taskOutputs: {} as <Wf>TaskOutputs` typed with every task id and
 *     exactly the output shapes the gates reference (so gates typecheck and
 *     the whole module typechecks under the per-definition typechecker).
 *
 * The module is erasable-syntax TS (no enums/namespaces/parameter
 * properties), imports only workflow-engine/workflow-types + runners, and
 * loads under Node's native type-stripping. */

import type { FieldType, FlowSpec, GateSpec, ValueSpec } from "./flow-spec";

// ─── small helpers ────────────────────────────────────────────────────

function pascal(id: string): string {
  return id.length === 0 ? "" : id[0].toUpperCase() + id.slice(1);
}

function json(value: string | number | boolean): string {
  return JSON.stringify(value);
}

function jsonValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? `[${value.map(json).join(", ")}]` : json(value);
}

function fieldType(type: FieldType): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
      return "string[]";
    case "number[]":
      return "number[]";
    case "boolean[]":
      return "boolean[]";
    case "object":
      return "Record<string, unknown>";
    case "object[]":
      return "Array<Record<string, unknown>>";
    default:
      return "unknown";
  }
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

// The cast a value sourced from a task output / item path needs to satisfy
// the declared field type (the source is `unknown` at the point of access).
function castTo(type: FieldType): string {
  return `as ${fieldType(type)} | undefined`;
}

// ConfigField rendered in bare authoring style (bare `key:` identifiers, not
// JSON.stringify's quoted keys — the schema-consistency check resolves
// createInstance payload keys through identifier-named properties).
function renderConfigField(f: {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string | boolean | number | string[];
  options?: string[];
}): string {
  const parts = [
    `key: ${json(f.key)}`,
    `label: ${json(f.label)}`,
    `type: ${json(f.type)}`,
  ];
  if (f.required !== undefined) parts.push(`required: ${f.required}`);
  if (f.hint) parts.push(`hint: ${json(f.hint)}`);
  if (f.placeholder) parts.push(`placeholder: ${json(f.placeholder)}`);
  if (f.defaultValue !== undefined)
    parts.push(`defaultValue: ${jsonValue(f.defaultValue)}`);
  if (f.options) parts.push(`options: [${f.options.map(json).join(", ")}]`);
  return `{ ${parts.join(", ")} }`;
}

function renderConfigFields(
  fields: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    hint?: string;
    placeholder?: string;
    defaultValue?: string | boolean | number | string[];
    options?: string[];
  }[]
): string {
  return fields.map(renderConfigField).join(", ");
}

// ─── gate rendering ───────────────────────────────────────────────────

function renderGate(gate: GateSpec): string {
  switch (gate.kind) {
    case "always":
      return "true";
    case "never":
      return "false";
    case "hasRunningTask":
      return "ctx.hasRunningTask";
    case "noRunningTask":
      return "!ctx.hasRunningTask";
    case "taskSuccess":
      return `ctx.taskOutputs.${gate.task}?.status === "success"`;
    case "taskError":
      return `ctx.taskOutputs.${gate.task}?.status === "error"`;
    case "taskOutputEquals": {
      // path is "output" or "output.<seg>.<seg>" — the outcome's output.
      const rest =
        gate.path === "output" ? "" : gate.path.slice("output.".length);
      const access =
        rest === ""
          ? "?.output"
          : `?.output${rest
              .split(".")
              .map((s) => `?.${s}`)
              .join("")}`;
      return `ctx.taskOutputs.${gate.task}${access} === ${json(gate.value)}`;
    }
    case "instanceStateEquals":
      return `ctx.workflowInstanceState.${gate.field} === ${json(gate.value)}`;
    case "errorCountAtLeast":
      return `(ctx.taskErrorCounts.${gate.task} ?? 0) >= ${gate.count}`;
    case "not":
      return `!(${renderGate(gate.gate)})`;
    case "and":
      return gate.gates.map((g) => `(${renderGate(g)})`).join(" && ");
    case "or":
      return gate.gates.map((g) => `(${renderGate(g)})`).join(" || ");
  }
}

// ─── derived task-output type ─────────────────────────────────────────

type OutputNode = {
  leaf?: string;
  children?: Map<string, OutputNode>;
};

// Collect every taskOutputEquals reference per task: the path relative to the
// task's output ("" = the whole output) and the comparison value's type.
// Mirrors the validation that keeps paths prefix-consistent.
function collectOutputPaths(
  spec: FlowSpec
): Map<string, { rest: string; type: string }[]> {
  const byTask = new Map<string, { rest: string; type: string }[]>();
  const visitGate = (gate: GateSpec) => {
    if (gate.kind === "taskOutputEquals") {
      const rest =
        gate.path === "output" ? "" : gate.path.slice("output.".length);
      const list = byTask.get(gate.task) ?? [];
      list.push({ rest, type: typeof gate.value });
      byTask.set(gate.task, list);
    } else if (gate.kind === "not") {
      visitGate(gate.gate);
    } else if (gate.kind === "and" || gate.kind === "or") {
      for (const g of gate.gates) visitGate(g);
    }
  };
  for (const wf of spec.workflows) {
    for (const state of wf.states) {
      for (const transition of state.autoTransitions ?? [])
        visitGate(transition.gate);
      for (const action of state.actions ?? [])
        if (action.gate) visitGate(action.gate);
    }
  }
  return byTask;
}

function buildOutputNode(paths: { rest: string; type: string }[]): OutputNode {
  const root: OutputNode = { children: new Map() };
  let rootLeaf: string | undefined;
  for (const { rest, type } of paths) {
    if (rest === "") {
      rootLeaf = rootLeaf ? unionType(rootLeaf, type) : type;
      continue;
    }
    let current = root;
    const segments = rest.split(".");
    for (let i = 0; i < segments.length - 1; i++) {
      const children = current.children ?? new Map();
      let next = children.get(segments[i]);
      if (!next) {
        next = { children: new Map() };
        children.set(segments[i], next);
        current.children = children;
      }
      current = next;
    }
    const children = current.children ?? new Map();
    const last = segments[segments.length - 1];
    const existing = children.get(last);
    if (existing) {
      existing.leaf = existing.leaf ? unionType(existing.leaf, type) : type;
    } else {
      children.set(last, { leaf: type });
    }
    current.children = children;
  }
  if (rootLeaf !== undefined) return { leaf: rootLeaf };
  return root;
}

function unionType(a: string, b: string): string {
  const parts = [...new Set([a, b].flatMap((t) => t.split(" | ")))];
  return parts.sort().join(" | ");
}

function renderOutputNode(node: OutputNode): string {
  if (node.leaf !== undefined) return node.leaf;
  const parts = [...(node.children ?? new Map()).entries()].map(
    ([segment, child]) => `${segment}?: ${renderOutputNode(child)}`
  );
  return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
}

// ─── value rendering (patch ops / edge transforms) ────────────────────

function renderPatchValue(value: ValueSpec, fieldTypeName: FieldType): string {
  switch (value.kind) {
    case "literal":
      return json(value.value);
    case "instanceId":
      return "ctx.instanceId";
    case "taskOutput":
      return `readPath(ctx.taskOutputs().${value.task}, ${json(value.path)}) ${castTo(fieldTypeName)}`;
  }
}

function renderEdgeValue(value: ValueSpec, fieldTypeName: FieldType): string {
  switch (value.kind) {
    case "literal":
      return json(value.value);
    case "instanceId":
      return "undefined"; // no instance id exists at edge time
    case "taskOutput":
      return `readPath(source.${value.task}, ${json(value.path)}) ${castTo(fieldTypeName)}`;
  }
}

// ─── the renderer ─────────────────────────────────────────────────────

export function renderFlowDefinition(spec: FlowSpec): string {
  const out: string[] = [];
  const emit = (level: number, text: string) =>
    out.push("  ".repeat(level) + text);

  const hasPatchOps = spec.workflows.some((wf) =>
    wf.states.some((s) => (s.tasks ?? []).some((t) => t.patch !== undefined))
  );
  const hasCompletionOutput = spec.workflows.some((wf) =>
    wf.states.some((s) =>
      (s.tasks ?? []).some((t) => t.completionOutput !== undefined)
    )
  );
  const needsReadPath = (() => {
    for (const wf of spec.workflows) {
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
    for (const edge of spec.edges ?? []) {
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
  if (hasPatchOps || hasCompletionOutput)
    emit(
      0,
      `import { ${[
        hasPatchOps && "defineOperations",
        hasCompletionOutput && "defineTool",
      ]
        .filter(Boolean)
        .join(", ")} } from "workflow-engine/runners";`
    );
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
  for (const wf of spec.workflows) {
    const byTask = collectOutputPaths(spec);
    const perWorkflow = new Map<string, { rest: string; type: string }[]>();
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        perWorkflow.set(task.id, byTask.get(task.id) ?? []);
      }
    }
    outputPathsByWorkflow.set(wf.id, perWorkflow);
  }

  const workflowNames: string[] = [];
  for (const wf of spec.workflows) {
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
        // declared fields (the parsed completion arguments ARE the output of
        // an ai-task); otherwise the type is derived from gate paths.
        const outputType = task.completionOutput
          ? `{ ${task.completionOutput
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

    // ── ops map (only when patch ops are declared) ──
    const patchTasks = tasks.filter((t) => t.patch !== undefined);
    if (patchTasks.length > 0) {
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
          if (f.render) parts.push(`render: ${JSON.stringify(f.render)}`);
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
          if (task.operations && task.operations.length > 0) {
            const ops = [...task.operations];
            if (task.patch) ops.push(`${wf.id}_${task.id}_patch`);
            emit(5, `operations: [${ops.map(json).join(", ")}],`);
          } else if (task.patch) {
            emit(5, `operations: [${json(`${wf.id}_${task.id}_patch`)}],`);
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
          if (task.systemPrompt)
            emit(5, `systemPrompt: ${json(task.systemPrompt)},`);
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
          emit(5, `gate: (ctx) => ${renderGate(transition.gate)},`);
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
          if (action.gate)
            emit(5, `gate: (ctx) => ${renderGate(action.gate)},`);
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
  emit(1, `id: ${json(spec.id)},`);
  emit(1, `label: ${json(spec.label)},`);
  if (spec.description) emit(1, `description: ${json(spec.description)},`);
  emit(1, `configSchema: [${renderConfigFields(spec.configSchema)}],`);
  if (spec.domainDir) emit(1, `domainDir: ${json(spec.domainDir)},`);
  emit(1, `workflows: [${workflowNames.join(", ")}],`);
  const opMapNames = spec.workflows
    .filter((wf) =>
      wf.states.some((s) => (s.tasks ?? []).some((t) => t.patch !== undefined))
    )
    .map((wf) => `${wf.id}Operations`);
  if (opMapNames.length > 0) {
    emit(1, `operations: { ${opMapNames.map((n) => `...${n}`).join(", ")} },`);
  }
  const completionToolMapNames = spec.workflows
    .filter((wf) =>
      wf.states.some((s) =>
        (s.tasks ?? []).some((t) => t.completionOutput !== undefined)
      )
    )
    .map((wf) => `${wf.id}CompletionTools`);
  if (completionToolMapNames.length > 0) {
    emit(
      1,
      `tools: [${completionToolMapNames.map((n) => `...${n}`).join(", ")}],`
    );
  }
  if (spec.actions && spec.actions.length > 0) {
    emit(1, "actions: [");
    for (const action of spec.actions) {
      emit(2, "{");
      emit(3, `id: ${json(action.id)},`);
      emit(3, `label: ${json(action.label)},`);
      if (action.variant) emit(3, `variant: ${json(action.variant)},`);
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
  for (const edge of spec.edges ?? []) {
    emit(2, "{");
    emit(3, `fromWorkflow: ${json(edge.fromWorkflow)},`);
    emit(3, `fromStates: [${edge.fromStates.map(json).join(", ")}],`);
    emit(3, `toWorkflow: ${json(edge.toWorkflow)},`);
    if (edge.fanOut) {
      const fan = edge.fanOut;
      emit(3, "transform: (source) => {");
      emit(
        4,
        `const items = readPath(source.${fan.task}, ${json(fan.path)}) as Array<Record<string, unknown>> | undefined ?? [];`
      );
      emit(4, "return items.map((item) => ({");
      for (const [field, value] of Object.entries(fan.fields)) {
        const fieldDecl = spec.workflows
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
        const fieldDecl = spec.workflows
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

  return `${out.join("\n")}\n`;
}
