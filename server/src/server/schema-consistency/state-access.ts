/** @private — extraction of workflow-instance-state patch writes from
 * operation/tool executor bodies. */

import ts from "typescript";
import type { ObjectLiteral } from "./ast.ts";
import { unwrap, walk } from "./ast.ts";

// Whether a call is `<method>()` / `<method>?.()` on the context parameter
// (`ctx.<method>(...)`). The receiver must be `ctx` — the engine passes the
// runtime context as the third op argument (and the second tool-executor
// argument) conventionally named `ctx`; a state patch on any other receiver
// (e.g. `task.patchWorkflowInstanceState`, where `task` is a `TaskDefinition`
// with no state methods) is a bug the declared-writes pass must not count as
// a writer.
function isCtxMethodCall(call: ts.CallExpression, methodName: string): boolean {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr) && !ts.isPropertyAccessChain(expr)) {
    return false;
  }
  return (
    expr.name.text === methodName &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "ctx"
  );
}

// Collect patch writes. A patch is passed to patchWorkflowInstanceState as an
// inline literal, or via a one-level local built with assignments:
//   const patch: Partial<X> = {};  patch.spec = args.spec;  ...(patch)
export function collectPatchWrites(fn: ts.Node, writes: Set<string>): void {
  const patchAliases = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isCallExpression(n)) return;
    if (!isCtxMethodCall(n, "patchWorkflowInstanceState")) return;
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

// Collect sibling-instance patch writes (E1). A sibling patch is passed to
// ctx.patchInstanceState(instanceId, { ...fields }) — the instance id is a
// dynamic argument (a title-resolved id), the patch literal is the second
// argument. The same inline-literal / one-level-alias collection as own
// patches.
export function collectSiblingPatchWrites(
  fn: ts.Node,
  writes: Set<string>
): void {
  const patchAliases = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isCallExpression(n)) return;
    if (!isCtxMethodCall(n, "patchInstanceState")) return;
    const arg = n.arguments[1];
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

// Collect flowState writes (E2). A flowState patch is passed to
// ctx.patchFlowState({ ...fields }); the single argument is the patch literal
// (same inline-literal / one-level-alias collection as instance patches). The
// definition's declared flowState fields are the write contract.
export function collectFlowStatePatchWrites(
  fn: ts.Node,
  writes: Set<string>
): void {
  const patchAliases = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isCallExpression(n)) return;
    if (!isCtxMethodCall(n, "patchFlowState")) return;
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

export function addLiteralKeys(literal: ObjectLiteral, out: Set<string>): void {
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
