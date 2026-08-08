// === SCHEMA CONSISTENCY CHECK ===
//
// The generic guard for the "definition IS the layout" contract: for every
// workflow definition registered by a preset, cross-references the declared
// state type (the workflowInstanceState anchor) against every read and every
// write of that state, and asserts the invariants:
//
//   1. every workflow declares a workflowInstanceState anchor (declared type)
//   2. every preset-authored write is a declared field (writes ⊆ declared)
//      — catches the reverse drift class (a tool writing `resolution` while
//        the type omits it)
//   3. every read has a writer: preset writes ∪ engine-provided fields
//      (reads ⊆ writes) — catches the motivating class (a gate reading a
//      field nothing ever writes: `validationFailures`, `projectId`)
//   4. engine-read fields (the dependsOn backstop) are declared
//   5. dead declarations and write-without-read fields are reported as
//      warnings, not failures
//
// Source-driven (a lightweight TypeScript AST over the preset files) rather
// than runtime introspection: the state type is erased at runtime, so only
// the source can answer "what does the type declare". Convention-bounded:
// reads are collected via `ctx.workflowInstanceState.X` /
// `ctx.workflowInstanceState().X` (direct or a one-level `const state = ...`
// alias, plus bounded-depth helper functions called with the context, e.g.
// readResolution(ctx)); writes via `patchWorkflowInstanceState({ ... })`
// literal keys (inline, shorthand, or built with `patch.field = ...`
// assignments), edge transform returns, and createInstance payload keys.
// Engine-provided fields (worktreePath/branchName/attempt) are exempt from
// the write-declaration and never-read checks — they are part of the engine
// contract, not preset authoring. Agent-composed writes (the create_instance
// tool) are intentionally unchecked — runtime data, not schema.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { engineCapabilities } from "workflow-engine/capabilities-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── preset enumeration ────────────────────────────────────────────────

const PRESETS = [
  { id: "queen-bee", dir: "presets/queen-bee" },
  { id: "wayfinder", dir: "presets/wayfinder" },
] as const;

const PRESET_ROOT = join(__dirname, "..", "..", "..");

// ─── minimal AST helpers ───────────────────────────────────────────────

type ObjectLiteral = ts.ObjectLiteralExpression;

function parseFile(absolutePath: string): ts.SourceFile {
  const text = readFileSync(absolutePath, "utf8");
  return ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function findFirst<T extends ts.Node>(
  node: ts.Node,
  predicate: (n: ts.Node) => n is T
): T | undefined {
  if (predicate(node)) return node;
  let found: T | undefined;
  ts.forEachChild(node, (child) => {
    if (found !== undefined) return;
    found = findFirst(child, predicate);
  });
  return found;
}

function findAll<T extends ts.Node>(
  node: ts.Node,
  predicate: (n: ts.Node) => n is T
): T[] {
  const found: T[] = [];
  walk(node, (n) => {
    if (predicate(n)) found.push(n);
  });
  return found;
}

function propertyOf(
  obj: ObjectLiteral,
  name: string
): ts.PropertyAssignment | undefined {
  const prop = obj.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === name
  );
  return prop;
}

function objectOf(obj: ObjectLiteral, name: string): ObjectLiteral | undefined {
  const prop = propertyOf(obj, name);
  if (!prop) return undefined;
  return ts.isObjectLiteralExpression(prop.initializer)
    ? prop.initializer
    : undefined;
}

function arrayOf(
  obj: ObjectLiteral,
  name: string
): ts.NodeArray<ts.Expression> | undefined {
  const prop = propertyOf(obj, name);
  if (!prop) return undefined;
  if (ts.isArrayLiteralExpression(prop.initializer)) {
    return prop.initializer.elements;
  }
  return undefined;
}

function stringValue(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return undefined;
}

// Unwrap parenthesized expressions, `as` casts, and `satisfies` wrappers
// (one-level boundary — enough for the authoring patterns in this repo).
function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current)) current = current.expression;
    else if (ts.isSatisfiesExpression(current)) current = current.expression;
    else return current;
  }
}

// ─── state-read / state-write extraction ───────────────────────────────

// Is this expression the workflow-instance state base? Matches
//   ctx.workflowInstanceState      (property access — gates)
//   ctx.workflowInstanceState()    (call — ops)
//   <alias>                        (a local const bound to either)
function isStateBase(
  expr: ts.Expression,
  aliases: ReadonlySet<string>
): boolean {
  if (ts.isIdentifier(expr) && aliases.has(expr.text)) return true;
  if (ts.isCallExpression(expr)) {
    return (
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "workflowInstanceState"
    );
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text === "workflowInstanceState";
  }
  return false;
}

// Collect reads of the form <stateBase>.<field> inside a function body. Reads
// that live in a pure helper called with the context (e.g. readResolution(ctx))
// are walked too, bounded to two levels so helper chains can't explode.
function collectStateReads(fn: ts.Node, reads: Set<string>, depth = 0): void {
  // One-level aliases: `const state = ctx.workflowInstanceState()` (casts ok).
  const aliases = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name)) return;
    if (!n.initializer) return;
    if (isStateBase(unwrap(n.initializer), new Set())) aliases.add(n.name.text);
  });

  walk(fn, (n) => {
    if (!ts.isPropertyAccessExpression(n)) return;
    if (isStateBase(unwrap(n.expression), aliases) && ts.isIdentifier(n.name)) {
      reads.add(n.name.text);
    }
  });

  // Helpers called with the context/state alias (bounded depth): the read may
  // live in a same-file pure function rather than the op/gate body itself.
  if (depth >= 2) return;
  const ctxNames = new Set([...aliases, "ctx", "rawCtx", "typed"]);
  const file = fn.getSourceFile();
  walk(fn, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return;
    const callee = n.expression.text;
    const passesContext = n.arguments.some(
      (a) => ts.isIdentifier(a) && ctxNames.has(a.text)
    );
    if (!passesContext) return;
    const helper = findFirst(
      file,
      (d): d is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(d) && d.name?.text === callee
    );
    if (!helper) return;
    collectStateReads(helper, reads, depth + 1);
  });
}

// Collect patch writes. A patch is passed to patchWorkflowInstanceState as an
// inline literal, or via a one-level local built with assignments:
//   const patch: Partial<X> = {};  patch.spec = args.spec;  ...(patch)
function collectPatchWrites(fn: ts.Node, writes: Set<string>): void {
  const patchAliases = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isCallExpression(n)) return;
    if (
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "patchWorkflowInstanceState"
    ) {
      return;
    }
    const arg = n.arguments[0];
    if (!arg) return;
    const literal = unwrap(arg);
    if (ts.isObjectLiteralExpression(literal)) addLiteralKeys(literal, writes);
    else if (ts.isIdentifier(literal)) patchAliases.add(literal.text);
  });
  if (patchAliases.size === 0) return;
  walk(fn, (n) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      patchAliases.has(n.expression.text) &&
      ts.isIdentifier(n.name)
    ) {
      writes.add(n.name.text);
    }
  });
}

function addLiteralKeys(literal: ObjectLiteral, out: Set<string>): void {
  for (const prop of literal.properties) {
    // Shorthand props ({ reviewIsStale }) are ShorthandPropertyAssignment.
    if (
      !ts.isPropertyAssignment(prop) &&
      !ts.isShorthandPropertyAssignment(prop)
    ) {
      continue;
    }
    if (ts.isIdentifier(prop.name)) out.add(prop.name.text);
    else if (ts.isStringLiteral(prop.name)) out.add(prop.name.text);
  }
}

// ─── anchor resolution ─────────────────────────────────────────────────

function declaredFieldsFor(
  config: ObjectLiteral,
  files: ts.SourceFile[]
): Set<string> | undefined {
  const anchor = propertyOf(config, "workflowInstanceState");
  if (!anchor) return undefined; // no anchor — flagged by the invariant
  const initializer = anchor.initializer;
  if (!ts.isAsExpression(initializer)) return undefined;
  const typeName =
    ts.isTypeReferenceNode(initializer.type) &&
    ts.isIdentifier(initializer.type.typeName)
      ? initializer.type.typeName.text
      : undefined;
  if (typeName === "Record") return new Set<string>(); // Record<string, never>
  if (!typeName) return undefined;
  for (const file of files) {
    const alias = findFirst(
      file,
      (n): n is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(n) && n.name.text === typeName
    );
    if (!alias) continue;
    if (!ts.isTypeLiteralNode(alias.type)) return new Set<string>();
    const fields = new Set<string>();
    for (const member of alias.type.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      if (ts.isIdentifier(member.name)) fields.add(member.name.text);
      else if (ts.isStringLiteral(member.name)) fields.add(member.name.text);
    }
    return fields;
  }
  return undefined;
}

// ─── edge / payload extraction ─────────────────────────────────────────

function collectEdgeWrites(
  flowDefinition: ObjectLiteral
): Map<string, Set<string>> {
  const byTarget = new Map<string, Set<string>>();
  for (const edgeExpr of arrayOf(flowDefinition, "edges") ?? []) {
    // Edges are often authored `{ ... } satisfies FlowEdge<...>`.
    const edge = unwrap(edgeExpr);
    if (!ts.isObjectLiteralExpression(edge)) continue;
    const toWorkflow = stringValue(propertyOf(edge, "toWorkflow")?.initializer);
    const transform = propertyOf(edge, "transform");
    if (!toWorkflow || !transform) continue;
    const keys = new Set<string>();
    collectReturnedObjectKeys(transform.initializer, keys);
    byTarget.set(toWorkflow, keys);
  }
  return byTarget;
}

function collectReturnedObjectKeys(fn: ts.Expression, out: Set<string>): void {
  walk(fn, (n) => {
    if (ts.isReturnStatement(n)) {
      if (n.expression) {
        const literal = unwrap(n.expression);
        if (ts.isObjectLiteralExpression(literal)) addLiteralKeys(literal, out);
      }
      return;
    }
    if (ts.isArrowFunction(n) && !ts.isBlock(n.body)) {
      const literal = unwrap(n.body);
      if (ts.isObjectLiteralExpression(literal)) addLiteralKeys(literal, out);
    }
  });
}

function collectPayloadWrites(
  sourceFiles: ts.SourceFile[]
): Map<string, Set<string>> {
  const byWorkflow = new Map<string, Set<string>>();
  for (const file of sourceFiles) {
    walk(file, (n) => {
      if (
        !ts.isPropertyAssignment(n) ||
        !ts.isIdentifier(n.name) ||
        n.name.text !== "createInstance"
      ) {
        return;
      }
      if (!ts.isObjectLiteralExpression(n.initializer)) return;
      const workflowId = stringValue(
        propertyOf(n.initializer, "workflowId")?.initializer
      );
      if (!workflowId) return;
      const set = byWorkflow.get(workflowId) ?? new Set<string>();
      for (const field of arrayOf(n.initializer, "fields") ?? []) {
        if (!ts.isObjectLiteralExpression(field)) continue;
        const key = stringValue(propertyOf(field, "key")?.initializer);
        if (key) set.add(key);
      }
      byWorkflow.set(workflowId, set);
    });
  }
  return byWorkflow;
}

// ─── ops / tools maps ──────────────────────────────────────────────────

function collectOpsMaps(files: ts.SourceFile[]): Map<string, ts.Node> {
  const ops = new Map<string, ts.Node>();
  for (const file of files) {
    walk(file, (n) => {
      if (
        !ts.isVariableStatement(n) ||
        !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return;
      }
      const name = n.declarationList.declarations[0]?.name;
      if (
        !name ||
        !ts.isIdentifier(name) ||
        !name.text.endsWith("Operations")
      ) {
        return;
      }
      const init = n.declarationList.declarations[0]?.initializer;
      if (!init) return;
      // defineOperations<TState>({ ... }) — the group literal is the factory's
      // first argument.
      const literal = unwrap(init);
      const group =
        ts.isCallExpression(literal) &&
        ts.isIdentifier(literal.expression) &&
        literal.expression.text === "defineOperations"
          ? literal.arguments[0]
          : literal;
      if (!group || !ts.isObjectLiteralExpression(group)) return;
      for (const prop of group.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
          continue;
        }
        ops.set(prop.name.text, prop.initializer);
      }
    });
  }
  return ops;
}

function collectToolsMaps(files: ts.SourceFile[]): Map<string, ts.Node> {
  const tools = new Map<string, ts.Node>();
  for (const file of files) {
    walk(file, (n) => {
      if (
        !ts.isVariableStatement(n) ||
        !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return;
      }
      const name = n.declarationList.declarations[0]?.name;
      if (!name || !ts.isIdentifier(name) || !name.text.endsWith("Tools")) {
        return;
      }
      const init = n.declarationList.declarations[0]?.initializer;
      if (!init || !ts.isArrayLiteralExpression(init)) return;
      for (const elementExpr of init.elements) {
        // defineTool({ ... }) — the tool literal is the factory's argument.
        const element = unwrap(elementExpr);
        const tool =
          ts.isCallExpression(element) &&
          ts.isIdentifier(element.expression) &&
          element.expression.text === "defineTool"
            ? element.arguments[0]
            : element;
        if (!tool || !ts.isObjectLiteralExpression(tool)) continue;
        const toolName = stringValue(propertyOf(tool, "name")?.initializer);
        const executor = propertyOf(tool, "executor");
        if (toolName && executor) tools.set(toolName, executor.initializer);
      }
    });
  }
  return tools;
}

// An op/tool initializer may be an identifier referencing a function declared
// elsewhere in the file; resolve it to the actual function node for walking.
function resolveFn(initializer: ts.Node, file: ts.SourceFile): ts.Node {
  if (!ts.isIdentifier(initializer)) return initializer;
  const decl = findFirst(
    file,
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) && n.name?.text === initializer.text
  );
  if (decl) return decl;
  const arrow = findFirst(
    file,
    (n): n is ts.VariableDeclaration =>
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === initializer.text
  );
  return arrow?.initializer ?? initializer;
}

// ─── per-workflow contract ─────────────────────────────────────────────

type WorkflowContract = {
  workflowId: string;
  declared: Set<string> | undefined;
  reads: Set<string>;
  writes: Set<string>;
};

const engineProvided = new Set(
  Object.keys(engineCapabilities.stateFields.engineProvided)
);
const engineRead = new Set(
  Object.keys(engineCapabilities.stateFields.engineRead)
);

function extractWorkflow(
  config: ObjectLiteral,
  files: ts.SourceFile[],
  opsByName: Map<string, ts.Node>,
  toolsByName: Map<string, ts.Node>,
  edgeWrites: Map<string, Set<string>>,
  payloadWrites: Map<string, Set<string>>
): WorkflowContract {
  const workflowId =
    stringValue(propertyOf(config, "id")?.initializer) ?? "unknown";
  const declared = declaredFieldsFor(config, files);
  const reads = new Set<string>();
  const writes = new Set<string>();

  // UI hint reads: instance title/subtitle and display field paths are dotted
  // paths into the instance state — a hint pointing at a never-written field
  // is dead UI. Static labels ("Integration") don't reference state, so only
  // segments that resolve to a declared field count as reads.
  const firstSegment = (path: string | undefined) => path?.split(".")[0];
  const instanceHint = objectOf(config, "instance");
  if (instanceHint) {
    for (const key of ["title", "subtitle"] as const) {
      const value = firstSegment(
        stringValue(propertyOf(instanceHint, key)?.initializer)
      );
      if (value !== undefined && declared?.has(value) === true)
        reads.add(value);
    }
  }
  const displayHint = objectOf(config, "display");
  const displayFields = displayHint
    ? arrayOf(displayHint, "fields")
    : undefined;
  for (const field of displayFields ?? []) {
    if (!ts.isObjectLiteralExpression(field)) continue;
    const value = firstSegment(
      stringValue(propertyOf(field, "path")?.initializer)
    );
    if (value !== undefined && declared?.has(value) === true) reads.add(value);
  }

  // Gates (inline in the config's states) + engine reads from the config.
  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    for (const listName of ["autoTransitions", "actions"] as const) {
      for (const item of arrayOf(stateExpr, listName) ?? []) {
        if (!ts.isObjectLiteralExpression(item)) continue;
        const gate = propertyOf(item, "gate");
        if (gate) collectStateReads(gate.initializer, reads);
        if (propertyOf(item, "dependsOnState")) reads.add("dependsOn");
      }
    }
    for (const task of arrayOf(stateExpr, "tasks") ?? []) {
      if (!ts.isObjectLiteralExpression(task)) continue;
      const workspace = stringValue(
        propertyOf(task, "workspacePath")?.initializer
      );
      if (workspace?.startsWith("@instance:")) {
        reads.add(workspace.slice("@instance:".length));
      }
      const input = stringValue(
        propertyOf(task, "inputFromInstanceState")?.initializer
      );
      if (input) {
        const segment = input.split(".")[0];
        if (segment) reads.add(segment);
      }
      const persist = objectOf(task, "persist");
      const persistPath = persist
        ? stringValue(propertyOf(persist, "path")?.initializer)
        : undefined;
      if (persistPath?.includes("{attempt}")) reads.add("attempt");
    }
  }

  // Ops this workflow's tasks reference: their reads and writes.
  const opNames = new Set<string>();
  const toolNames = new Set<string>();
  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    for (const task of arrayOf(stateExpr, "tasks") ?? []) {
      if (!ts.isObjectLiteralExpression(task)) continue;
      for (const opName of arrayOf(task, "operations") ?? []) {
        const name = stringValue(opName);
        if (name) opNames.add(name);
      }
      for (const toolName of arrayOf(task, "tools") ?? []) {
        const name = stringValue(toolName);
        if (name) toolNames.add(name);
      }
    }
  }
  for (const name of opNames) {
    const fn = opsByName.get(name);
    if (fn) {
      collectStateReads(fn, reads);
      collectPatchWrites(fn, writes);
    } else {
      const op = engineCapabilities.engineOperations.find(
        (o) => o.name === name
      );
      if (op) {
        for (const field of op.reads) reads.add(field);
        for (const field of op.writes) writes.add(field);
      }
    }
  }
  for (const name of toolNames) {
    const fn = toolsByName.get(name);
    if (fn) collectPatchWrites(fn, writes);
  }

  // Edges + createInstance payloads feeding this workflow.
  for (const field of edgeWrites.get(workflowId) ?? []) writes.add(field);
  for (const field of payloadWrites.get(workflowId) ?? []) writes.add(field);

  return { workflowId, declared, reads, writes };
}

// ─── the invariants ────────────────────────────────────────────────────

function assertContract(contract: WorkflowContract, warnings: string[]): void {
  const { workflowId, declared, reads, writes } = contract;

  // 1. Anchor required — the declared state type is the contract.
  assert.ok(
    declared !== undefined,
    `[${workflowId}] missing workflowInstanceState anchor — every workflow must declare its state type`
  );

  // 2. Preset-authored writes must be declared fields.
  const presetWrites = new Set(
    [...writes].filter((f) => !engineProvided.has(f))
  );
  const undeclaredWrites = [...presetWrites].filter((f) => !declared?.has(f));
  assert.deepEqual(
    undeclaredWrites,
    [],
    `[${workflowId}] writes undeclared in the state type: ${undeclaredWrites.join(", ")}`
  );

  // 3. Every read must have a writer (preset writes ∪ engine-provided).
  const allWrites = new Set([...writes, ...engineProvided]);
  const unwrittenReads = [...reads].filter((f) => !allWrites.has(f));
  assert.deepEqual(
    unwrittenReads,
    [],
    `[${workflowId}] reads with no writer: ${unwrittenReads.join(", ")} ` +
      `(reads: ${[...reads].sort().join(", ")}; writes: ${[...allWrites].sort().join(", ")})`
  );

  // 4. Engine-read fields the workflow actually reads (the dependsOn
  // backstop) must be declared. Only enforced when read — a workflow that
  // never uses dependsOnState doesn't need the field.
  const undeclaredEngineReads = [...engineRead].filter(
    (f) => reads.has(f) && !declared?.has(f)
  );
  assert.deepEqual(
    undeclaredEngineReads,
    [],
    `[${workflowId}] engine-read fields not declared: ${undeclaredEngineReads.join(", ")}`
  );

  // 5. Warnings: dead declarations and write-without-read fields. Engine-
  // provided fields are exempt — a flow not using one is fine, not drift.
  const allReads = new Set([...reads, ...engineRead]);
  const neverRead = [...(declared ?? [])].filter(
    (f) => !allReads.has(f) && !engineProvided.has(f)
  );
  if (neverRead.length > 0) {
    warnings.push(`[${workflowId}] fields never read: ${neverRead.join(", ")}`);
  }
  const writtenNeverRead = [...allWrites].filter(
    (f) => !allReads.has(f) && !engineProvided.has(f)
  );
  if (writtenNeverRead.length > 0) {
    warnings.push(
      `[${workflowId}] written but never read: ${writtenNeverRead.join(", ")}`
    );
  }
}

// ─── the suite ─────────────────────────────────────────────────────────

describe("schema consistency", () => {
  for (const preset of PRESETS) {
    it(`${preset.id} workflows hold the state contract`, () => {
      const presetRoot = join(PRESET_ROOT, preset.dir);
      const files = collectFiles(presetRoot).map(parseFile);
      const warnings: string[] = [];

      const opsMaps = collectOpsMaps(files);
      const toolsMaps = collectToolsMaps(files);
      const payloadWrites = collectPayloadWrites(files);
      const fileByPath = new Map(files.map((f) => [f.fileName, f]));

      const opsByName = new Map<string, ts.Node>();
      for (const [name, init] of opsMaps) {
        const containingFile =
          fileByPath.get(init.getSourceFile().fileName) ?? init.getSourceFile();
        opsByName.set(name, resolveFn(init, containingFile));
      }
      const toolsByName = new Map<string, ts.Node>();
      for (const [name, init] of toolsMaps) {
        const containingFile =
          fileByPath.get(init.getSourceFile().fileName) ?? init.getSourceFile();
        toolsByName.set(name, resolveFn(init, containingFile));
      }

      // Edge transforms from every flow definition in the preset.
      const edgeWrites = new Map<string, Set<string>>();
      for (const file of files) {
        const flowDefs = findAll(
          file,
          (n): n is ObjectLiteral =>
            ts.isObjectLiteralExpression(n) &&
            propertyOf(n, "edges") !== undefined
        );
        for (const flowDef of flowDefs) {
          for (const [target, keys] of collectEdgeWrites(flowDef)) {
            const merged = edgeWrites.get(target) ?? new Set<string>();
            for (const key of keys) merged.add(key);
            edgeWrites.set(target, merged);
          }
        }
      }

      // Every defineWorkflow call in the preset is a registered workflow.
      const contracts: WorkflowContract[] = [];
      for (const file of files) {
        const configs = findAll(file, (n): n is ObjectLiteral => {
          if (!ts.isObjectLiteralExpression(n)) return false;
          const parent = n.parent;
          if (parent === undefined || !ts.isCallExpression(parent)) {
            return false;
          }
          return (
            ts.isIdentifier(parent.expression) &&
            parent.expression.text === "defineWorkflow"
          );
        });
        for (const config of configs) {
          contracts.push(
            extractWorkflow(
              config,
              files,
              opsByName,
              toolsByName,
              edgeWrites,
              payloadWrites
            )
          );
        }
      }

      assert.ok(
        contracts.length >= 2,
        `expected at least 2 workflows in ${preset.id}, found ${contracts.length}`
      );

      for (const contract of contracts) {
        assertContract(contract, warnings);
      }

      for (const warning of warnings) {
        // eslint-disable-next-line no-console
        console.log(`schema-consistency warning: ${warning}`);
      }
    });
  }
});
