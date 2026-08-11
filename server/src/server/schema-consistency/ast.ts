/** @private — minimal TypeScript AST helpers (property/array reads,
 * unwrapping, walking) used by every extraction pass. */

import ts from "typescript";
import type { SchemaCheckFile } from "./report-types.ts";

export type ObjectLiteral = ts.ObjectLiteralExpression;

export function parseFile(file: SchemaCheckFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function findFirst<T extends ts.Node>(
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

export function findAll<T extends ts.Node>(
  node: ts.Node,
  predicate: (n: ts.Node) => n is T
): T[] {
  const found: T[] = [];
  walk(node, (n) => {
    if (predicate(n)) found.push(n);
  });
  return found;
}

export function propertyOf(
  obj: ObjectLiteral,
  name: string
): ts.PropertyAssignment | undefined {
  const prop = obj.properties.find((p): p is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(p)) return false;
    if (ts.isIdentifier(p.name)) return p.name.text === name;
    if (ts.isStringLiteral(p.name)) return p.name.text === name;
    return false;
  });
  return prop;
}

export function objectOf(
  obj: ObjectLiteral,
  name: string
): ObjectLiteral | undefined {
  const prop = propertyOf(obj, name);
  if (!prop) return undefined;
  return ts.isObjectLiteralExpression(prop.initializer)
    ? prop.initializer
    : undefined;
}

export function arrayOf(
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

export function stringValue(
  expr: ts.Expression | undefined
): string | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return undefined;
}

// Unwrap parenthesized expressions, `as` casts, and `satisfies` wrappers
// (one-level boundary — enough for the authoring patterns in this repo).
export function unwrap(expr: ts.Expression): ts.Expression {
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
