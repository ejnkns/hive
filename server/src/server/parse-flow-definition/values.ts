/** @private — value-source and edge-transform-shape matchers: the
 * readPath(...) task-output accesses, patch/edge/fan-out field values, and
 * the four edge transform closures the renderer emits (render-value.ts),
 * reversed back into ValueSpecs and the EdgeSpec fields/fanOut/transform
 * shapes. */

import ts from "typescript";
import type {
  EdgeTransformRefSpec,
  FanOutValueSpec,
  ValueSpec,
} from "../flow-blueprint.ts";
import { unwrap } from "../schema-consistency.ts";
import { type ParseContext, refPathFor } from "./context.ts";
import { literalScalar } from "./read.ts";

// `readPath(<source>, "<path>")` — the readPath call's source expression and
// dotted path. The `as <T> | undefined` cast the renderer wraps around it is
// stripped by unwrap.
export function readPathCall(expr: ts.Expression):
  | {
      source: ts.Expression;
      path: string;
    }
  | undefined {
  const value = unwrap(expr);
  if (
    !ts.isCallExpression(value) ||
    !ts.isIdentifier(value.expression) ||
    value.expression.text !== "readPath"
  ) {
    return undefined;
  }
  const pathArg = value.arguments[1];
  if (pathArg === undefined) return undefined;
  const path = unwrap(pathArg);
  if (!ts.isStringLiteral(path)) return undefined;
  return { source: value.arguments[0], path: path.text };
}

// `ctx.taskOutputs().<task>` — the patch-op source access.
export function taskOutputsAccess(expr: ts.Expression): string | undefined {
  const value = unwrap(expr);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.name)) {
    return undefined;
  }
  const call = unwrap(value.expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) {
    return undefined;
  }
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) {
    return undefined;
  }
  const base = unwrap(callee.expression);
  if (!ts.isIdentifier(base) || base.text !== "ctx") return undefined;
  if (callee.name.text !== "taskOutputs") return undefined;
  return value.name.text;
}

// `<param>.<task>` — the edge-transform source access (the transform's own
// parameter carries the source workflow's task outputs).
export function sourceTaskAccess(
  expr: ts.Expression,
  paramName: string
): string | undefined {
  const value = unwrap(expr);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.name)) {
    return undefined;
  }
  const base = unwrap(value.expression);
  if (!ts.isIdentifier(base) || base.text !== paramName) return undefined;
  return value.name.text;
}

// `ctx.instanceId`.
export function isCtxInstanceId(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.name)) {
    return false;
  }
  if (value.name.text !== "instanceId") return false;
  const base = unwrap(value.expression);
  return ts.isIdentifier(base) && base.text === "ctx";
}

// ─── field values ────────────────────────────────────────────────────

// A patch-op value: `readPath(ctx.taskOutputs().<task>, "<path>")` →
// taskOutput; `ctx.instanceId` → instanceId; a scalar literal → literal; an
// identifier resolves to the hoisted const the generated op binds a sourced
// field to (`const <field> = readPath(...) as <T> | undefined;`).
export function parsePatchValue(
  expr: ts.Expression,
  fn?: ts.FunctionLikeDeclaration
): ValueSpec | undefined {
  if (isCtxInstanceId(expr)) return { kind: "instanceId" };
  const literal = literalScalar(expr);
  if (literal !== undefined) return { kind: "literal", value: literal };
  if (ts.isIdentifier(expr) && fn !== undefined) {
    const initializer = constInitializerIn(fn, expr.text);
    if (initializer !== undefined) {
      const read = readPathCall(initializer);
      if (read !== undefined) {
        const task = taskOutputsAccess(read.source);
        if (task !== undefined) {
          return { kind: "taskOutput", task, path: read.path };
        }
      }
    }
    return undefined;
  }
  const read = readPathCall(expr);
  if (read !== undefined) {
    const task = taskOutputsAccess(read.source);
    if (task !== undefined) {
      return { kind: "taskOutput", task, path: read.path };
    }
  }
  return undefined;
}

// The `const <name> = <init>;` initializer in a function body (the hoisted
// sourced fields the generated patch ops declare).
function constInitializerIn(
  fn: ts.FunctionLikeDeclaration,
  name: string
): ts.Expression | undefined {
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
  if (fn.body !== undefined) visit(fn.body);
  return found;
}

// An edge field value: `readPath(source.<task>, "<path>")` → taskOutput; a
// scalar literal → literal. (`undefined` — the renderer's instanceId edge
// emission — is not representable; the validator rejects instanceId on edges.)
export function parseEdgeValue(
  expr: ts.Expression,
  paramName: string
): ValueSpec | undefined {
  const literal = literalScalar(expr);
  if (literal !== undefined) return { kind: "literal", value: literal };
  const read = readPathCall(expr);
  if (read !== undefined) {
    const task = sourceTaskAccess(read.source, paramName);
    if (task !== undefined) {
      return { kind: "taskOutput", task, path: read.path };
    }
  }
  return undefined;
}

// A fan-out item value: `item as <T>` → itemPath ""; `readPath(item, "<p>")`
// → itemPath <p>; a scalar literal → literal.
export function parseFanOutValue(
  expr: ts.Expression
): FanOutValueSpec | undefined {
  if (
    ts.isAsExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "item"
  ) {
    return { kind: "itemPath", path: "" };
  }
  const literal = literalScalar(expr);
  if (literal !== undefined) return { kind: "literal", value: literal };
  const read = readPathCall(expr);
  if (read !== undefined) {
    const source = unwrap(read.source);
    if (ts.isIdentifier(source) && source.text === "item") {
      return { kind: "itemPath", path: read.path };
    }
  }
  return undefined;
}

// ─── the four edge transform shapes ──────────────────────────────────

export type EdgeTransformParse =
  | { kind: "fields"; fields: Record<string, ValueSpec> }
  | {
      kind: "fanOut";
      fanOut: {
        task: string;
        path: string;
        fields: Record<string, FanOutValueSpec>;
      };
    }
  | { kind: "transform"; transform: EdgeTransformRefSpec };

export function parseEdgeTransform(
  arrow: ts.ArrowFunction,
  context: ParseContext,
  path: string
): EdgeTransformParse | undefined {
  if (arrow.parameters.length === 0) {
    // `transform: () => ({})` — a pure signal edge with empty fields.
    if (ts.isBlock(arrow.body)) return undefined;
    const body = unwrap(arrow.body);
    if (ts.isObjectLiteralExpression(body) && body.properties.length === 0) {
      return { kind: "fields", fields: {} };
    }
    return undefined;
  }
  if (arrow.parameters.length !== 1) return undefined;
  const param = arrow.parameters[0];
  if (!ts.isIdentifier(param.name)) return undefined;
  const paramName = param.name.text;

  const body = arrow.body;
  if (!ts.isBlock(body)) {
    // Shape 1: `(source) => ({ <f>: <value>, ... })`.
    const object = unwrap(body as ts.Expression);
    if (
      !ts.isObjectLiteralExpression(object) ||
      object.properties.length === 0
    ) {
      return undefined;
    }
    const fields: Record<string, ValueSpec> = {};
    for (const prop of object.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        return undefined;
      }
      const value = parseEdgeValue(prop.initializer, paramName);
      if (value === undefined) return undefined;
      fields[prop.name.text] = value;
    }
    return { kind: "fields", fields };
  }

  // Shapes 3/4: a two-statement block (`const <v> = <init>; return ...`).
  if (body.statements.length !== 2) return undefined;
  const first = body.statements[0];
  const second = body.statements[1];
  if (!ts.isVariableStatement(first)) return undefined;
  const declaration = first.declarationList.declarations[0];
  if (
    !declaration ||
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer
  ) {
    return undefined;
  }
  if (!ts.isReturnStatement(second) || !second.expression) return undefined;
  const variableName = declaration.name.text;
  const initializer = unwrap(declaration.initializer);
  const returned = unwrap(second.expression);

  // Shape 3 (fan-out): the items read + `items.map((item) => ({ ... }))`.
  const fanOutSource = fanOutSourceRead(initializer);
  if (fanOutSource !== undefined) {
    const map = mapOver(returned, variableName);
    if (map === undefined || !ts.isIdentifier(map.itemName)) return undefined;
    const fields: Record<string, FanOutValueSpec> = {};
    for (const prop of map.object.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        return undefined;
      }
      const value = parseFanOutValue(prop.initializer);
      if (value === undefined) return undefined;
      fields[prop.name.text] = value;
    }
    return {
      kind: "fanOut",
      fanOut: { task: fanOutSource.task, path: fanOutSource.path, fields },
    };
  }

  // Shape 4 (transform ref): `const out = <binding>(source);` +
  // `(Array.isArray(out) ? out : [out]).map((row) => ({ ... }))`.
  const refCall = transformRefCall(initializer);
  if (refCall !== undefined && ts.isIdentifier(refCall.source)) {
    if (refCall.source.text !== paramName) return undefined;
    const map = mapOver(returned, variableName);
    if (map === undefined || !ts.isIdentifier(map.itemName)) return undefined;
    const ref = refPathFor(context, refCall.binding);
    if (ref === undefined) return undefined;
    const fields: string[] = [];
    for (const prop of map.object.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        return undefined;
      }
      // `row.<field> as <T> | undefined` — the property access name must
      // match the written key (the renderer emits `row.<field>` per key).
      const access = rowAccess(prop.initializer, map.itemName.text);
      if (access === undefined || access !== prop.name.text) return undefined;
      fields.push(prop.name.text);
    }
    context.refs.push({
      kind: "transform",
      ref,
      exportName:
        context.bindings.get(refCall.binding)?.exportName ?? refCall.binding,
      fields,
      path,
    });
    return { kind: "transform", transform: { ref, fields } };
  }

  return undefined;
}

// `readPath(source.<task>, "<path>") as Array<Record<string, unknown>> |
// undefined ?? []` — the fan-out items read.
function fanOutSourceRead(
  initializer: ts.Expression
): { task: string; path: string } | undefined {
  if (!ts.isBinaryExpression(initializer)) return undefined;
  if (initializer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) {
    return undefined;
  }
  const fallback = unwrap(initializer.right);
  if (
    !ts.isArrayLiteralExpression(fallback) ||
    fallback.elements.length !== 0
  ) {
    return undefined;
  }
  const read = readPathCall(initializer.left);
  if (read === undefined) return undefined;
  const task = sourceTaskAccess(read.source, "source");
  if (task === undefined) return undefined;
  return { task, path: read.path };
}

// `<binding>(<param>)` — the transform-ref call.
function transformRefCall(
  initializer: ts.Expression
): { binding: string; source: ts.Expression } | undefined {
  if (
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression)
  ) {
    return undefined;
  }
  const source = initializer.arguments[0];
  if (source === undefined) return undefined;
  return { binding: initializer.expression.text, source };
}

// `(<collection>).map((<item>) => ({ ... }))` — the map over a collection
// with its item callback and the mapped object literal. The collection is the
// hoisted variable itself (fan-out: `items.map`) or the single-vs-array
// normalization the renderer wraps a referenced transform's output in
// (`(Array.isArray(out) ? out : [out]).map`).
function mapOver(
  expr: ts.Expression,
  collectionName: string
): { itemName: ts.Identifier; object: ts.ObjectLiteralExpression } | undefined {
  if (!ts.isCallExpression(expr)) return undefined;
  const callee = unwrap(expr.expression);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) {
    return undefined;
  }
  if (callee.name.text !== "map") return undefined;
  const base = unwrap(callee.expression);
  const isDirect = ts.isIdentifier(base) && base.text === collectionName;
  const isNormalized =
    ts.isConditionalExpression(base) &&
    isArrayOf(base.condition, collectionName) &&
    ts.isIdentifier(unwrap(base.whenTrue)) &&
    unwrap(base.whenTrue).getText() === collectionName &&
    ts.isArrayLiteralExpression(unwrap(base.whenFalse)) &&
    unwrap(base.whenFalse).getText() === `[${collectionName}]`;
  if (!isDirect && !isNormalized) return undefined;
  const callback = expr.arguments[0];
  if (
    !callback ||
    !ts.isArrowFunction(callback) ||
    callback.parameters.length !== 1
  ) {
    return undefined;
  }
  const itemParam = callback.parameters[0];
  if (!ts.isIdentifier(itemParam.name)) return undefined;
  if (ts.isBlock(callback.body)) return undefined;
  const body = unwrap(callback.body);
  if (!ts.isObjectLiteralExpression(body)) return undefined;
  return { itemName: itemParam.name, object: body };
}

// `Array.isArray(<name>)`.
function isArrayOf(expr: ts.Expression, name: string): boolean {
  const value = unwrap(expr);
  if (!ts.isCallExpression(value)) return false;
  const callee = unwrap(value.expression);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) {
    return false;
  }
  if (callee.name.text !== "isArray") return false;
  const base = unwrap(callee.expression);
  if (!ts.isIdentifier(base) || base.text !== "Array") return false;
  const target = value.arguments[0];
  if (!target) return false;
  const arg = unwrap(target);
  return ts.isIdentifier(arg) && arg.text === name;
}

// `row.<field> as <T> | undefined` → the accessed field name.
function rowAccess(expr: ts.Expression, rowName: string): string | undefined {
  const value = unwrap(expr);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.name)) {
    return undefined;
  }
  const base = unwrap(value.expression);
  if (!ts.isIdentifier(base) || base.text !== rowName) return undefined;
  return value.name.text;
}
