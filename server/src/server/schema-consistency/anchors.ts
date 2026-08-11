/** @private — resolution of the workflowInstanceState anchor type to its
 * declared field set. */

import ts from "typescript";
import type { ObjectLiteral } from "./ast.ts";
import { findFirst, propertyOf } from "./ast.ts";

export function declaredFieldsFor(
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
