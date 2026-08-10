/** @private — extraction of edge-transform writes and createInstance
 * payload keys feeding each workflow. */

import ts from "typescript";
import type { ObjectLiteral } from "./ast";
import { arrayOf, propertyOf, stringValue, unwrap, walk } from "./ast";
import { addLiteralKeys } from "./state-access";

export function collectEdgeWrites(
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

export function collectReturnedObjectKeys(
  fn: ts.Expression,
  out: Set<string>
): void {
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

export function collectPayloadWrites(
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
