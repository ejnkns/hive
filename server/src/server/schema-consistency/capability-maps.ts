/** @private — resolution of an op/tool name to its function node. */

import ts from "typescript";
import { findFirst } from "./ast.ts";

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
