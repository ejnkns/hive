/** @private — collection of defineOperations/defineTool groups and the
 * resolution of an op/tool name to its function node. */

import ts from "typescript";
import { findFirst, propertyOf, stringValue, unwrap, walk } from "./ast.ts";

export function collectOpsMaps(files: ts.SourceFile[]): Map<string, ts.Node> {
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

export function collectToolsMaps(files: ts.SourceFile[]): Map<string, ts.Node> {
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
export function resolveFn(initializer: ts.Node, file: ts.SourceFile): ts.Node {
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

// ─── structural soundness (warnings) ─────────────────────────────────
//
// The read↔write invariants prove the state contract; this pass assesses the
// state machine itself. Every finding is a *warning*: edge-level reachability
// is decidable, but gate semantics are not statically evaluable, so the whole
// class stays advisory (never fails the gate) — a flow author sees "this
// state can never be entered" without the check blocking a work-in-progress
// definition.
