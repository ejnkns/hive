/** @private — the reference side of the reverse renderer: the entry's import
 * lines → the binding map (use-site symbol → module path + declared export
 * name), and the `writes` recovery for tool/operation refs from the session's
 * referenced files (the same state-access extraction the schema-consistency
 * check uses, so the recovered writes match the actual executor bodies). */

import ts from "typescript";
import { refExportName } from "../flow-blueprint/validate-ref.ts";
import {
  collectPatchWrites,
  parseFile,
  resolveFn,
  unwrap,
} from "../schema-consistency.ts";
import type { ImportBinding } from "./context.ts";

// Every relative import of the entry: binding → the module path and the
// declared export name (a collision-disambiguated `import { x as y }` keeps
// exportName "x" and binding "y"). Package and engine imports are not
// blueprint references and are ignored.
export function buildBindingMap(
  sourceFile: ts.SourceFile
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const ref = specifier.text;
    if (!ref.startsWith("./") && !ref.startsWith("../")) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      const exportName = element.propertyName?.text ?? element.name.text;
      const binding = element.name.text;
      bindings.set(binding, { exportName, ref });
    }
  }
  return bindings;
}

// The declared export name a reference must have for the renderer to import
// it back identically (refExportName is the ref-identity authority — a
// binding that deviates cannot round-trip and is reported by the caller).
export function expectedExportName(
  kind: "gate" | "tool" | "operation" | "transform" | "extract" | "prompt",
  idOrRef: { id: string; ref: string } | { ref: string }
): string {
  return refExportName(kind, idOrRef);
}

// ─── writes recovery (the files pass) ────────────────────────────────

// The instance-state fields a referenced tool's executors patch, read from
// the file's `<id>Tools` list; undefined when the file is absent.
export function recoverToolWrites(
  ref: string,
  id: string,
  files: Record<string, string> | undefined
): string[] | undefined {
  const source = files?.[ref];
  if (source === undefined) return undefined;
  const sourceFile = parseFile({ path: ref, source });
  const list = exportConstInitializer(sourceFile, `${id}Tools`);
  if (list === undefined) return undefined;
  const writes = new Set<string>();
  const elements = ts.isArrayLiteralExpression(list) ? list.elements : [list];
  for (const element of elements) {
    const tool = toolLiteralOf(element);
    if (tool === undefined) continue;
    const executor = toolProperty(tool, "executor");
    if (executor === undefined) continue;
    collectPatchWrites(resolveFn(executor, sourceFile), writes);
  }
  return [...writes];
}

// The instance-state fields a referenced operation map's op bodies patch,
// read from the file's `<id>Operations` map; undefined when the file is
// absent.
export function recoverOperationWrites(
  ref: string,
  id: string,
  files: Record<string, string> | undefined
): string[] | undefined {
  const source = files?.[ref];
  if (source === undefined) return undefined;
  const sourceFile = parseFile({ path: ref, source });
  const map = exportConstInitializer(sourceFile, `${id}Operations`);
  if (map === undefined) return undefined;
  const group = opsGroupLiteral(map);
  if (group === undefined) return undefined;
  const writes = new Set<string>();
  for (const prop of group.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    collectPatchWrites(resolveFn(prop.initializer, sourceFile), writes);
  }
  return [...writes];
}

// The `export const <name> = ...` initializer in a referenced file.
function exportConstInitializer(
  sourceFile: ts.SourceFile,
  name: string
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExport = statement.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!isExport) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

// `defineTool({ ... })` → the tool literal (or a bare literal).
function toolLiteralOf(
  expr: ts.Expression
): ts.ObjectLiteralExpression | undefined {
  const value = unwrap(expr);
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) {
    return ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  if (value.expression.text !== "defineTool") return undefined;
  const arg = value.arguments[0];
  return arg !== undefined && ts.isObjectLiteralExpression(arg)
    ? arg
    : undefined;
}

// The `defineOperations<TState>({ ... })` group literal (or a bare map).
function opsGroupLiteral(
  expr: ts.Expression
): ts.ObjectLiteralExpression | undefined {
  const value = unwrap(expr);
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) {
    return ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  if (value.expression.text !== "defineOperations") return undefined;
  const arg = value.arguments[0];
  return arg !== undefined && ts.isObjectLiteralExpression(arg)
    ? arg
    : undefined;
}

function toolProperty(
  tool: ts.ObjectLiteralExpression,
  key: string
): ts.Expression | undefined {
  const found = tool.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === key
  );
  return found?.initializer;
}
