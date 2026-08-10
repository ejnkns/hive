/** @private — extraction of workflow-instance-state reads and patch writes
 * from operation/tool function bodies. */

import ts from "typescript";
import type { ObjectLiteral } from "./ast";
import { findFirst, unwrap, walk } from "./ast";

export function isStateBase(
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
export function collectStateReads(
  fn: ts.Node,
  reads: Set<string>,
  depth = 0
): void {
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
export function collectPatchWrites(fn: ts.Node, writes: Set<string>): void {
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

// ─── anchor resolution ─────────────────────────────────────────────────
