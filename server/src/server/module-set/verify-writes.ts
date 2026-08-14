/** @private — declared writes vs actual executor bodies: a definition
 * declares each custom tool/operation ref's `writes` (the instance-state
 * fields its executors patch) so the read↔write invariant can count them, but
 * declarations can lie. This pass parses each referenced file and collects
 * the fields its executors actually patch (the same state-access extraction
 * the schema-consistency check uses), reporting any field the executor writes
 * that the definition did not declare — the invariant would undercount the
 * writer, so the gate rejects it. */

import ts from "typescript";
import type { FlowDefinition } from "workflow-engine/workflow-types";
import { ENGINE_PROVIDED } from "../flow-definition/constants.ts";
import {
  collectPatchWrites,
  parseFile,
  resolveFn,
  unwrap,
} from "../schema-consistency.ts";

export type WriteFinding = {
  ref: string;
  message: string;
};

export function verifyDeclaredWrites(
  definition: FlowDefinition,
  files: Record<string, string>
): WriteFinding[] {
  const findings: WriteFinding[] = [];

  for (const tool of definition.tools ?? []) {
    const declared = new Set(tool.writes ?? []);
    const actual = toolExecutorWrites(tool.ref, `${tool.id}Tools`, files);
    if (actual === undefined) continue;
    for (const field of actual) {
      // Engine-provided fields (worktreePath, branchName, attempt) are the
      // engine's own writes — the invariant exempts them, so an executor
      // patching one needs no declaration.
      if (ENGINE_PROVIDED.has(field)) continue;
      if (!declared.has(field)) {
        findings.push({
          ref: tool.ref,
          message: `tool "${tool.id}" executor patches instance-state field "${field}" which is not declared in the tool's writes (declared: ${[...declared].join(", ") || "none"}) — declare it or the read↔write invariant undercounts the writer`,
        });
      }
    }
  }

  for (const op of definition.operations ?? []) {
    const declared = new Set(op.writes ?? []);
    const actual = operationWrites(op.ref, `${op.id}Operations`, files);
    if (actual === undefined) continue;
    for (const field of actual) {
      if (ENGINE_PROVIDED.has(field)) continue;
      if (!declared.has(field)) {
        findings.push({
          ref: op.ref,
          message: `operation "${op.id}" patches instance-state field "${field}" which is not declared in the operation's writes (declared: ${[...declared].join(", ") || "none"}) — declare it or the read↔write invariant undercounts the writer`,
        });
      }
    }
  }

  return findings;
}

// The instance-state fields a referenced tool list's executors patch
// (`<id>Tools` — defineTool entries with executor bodies).
function toolExecutorWrites(
  ref: string,
  exportName: string,
  files: Record<string, string>
): Set<string> | undefined {
  const source = files[ref];
  if (source === undefined) return undefined;
  const sourceFile = parseFile({ path: ref, source });
  const list = exportConstInitializer(sourceFile, exportName);
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
  return writes;
}

// The instance-state fields a referenced operations map's op bodies patch
// (`<id>Operations` — defineOperations entries).
function operationWrites(
  ref: string,
  exportName: string,
  files: Record<string, string>
): Set<string> | undefined {
  const source = files[ref];
  if (source === undefined) return undefined;
  const sourceFile = parseFile({ path: ref, source });
  const map = exportConstInitializer(sourceFile, exportName);
  if (map === undefined) return undefined;
  const group = opsGroupLiteral(map);
  if (group === undefined) return undefined;
  const writes = new Set<string>();
  for (const prop of group.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    collectPatchWrites(resolveFn(prop.initializer, sourceFile), writes);
  }
  return writes;
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
