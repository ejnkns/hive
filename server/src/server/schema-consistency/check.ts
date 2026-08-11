/** @private — the check: parse the files, extract every workflow contract,
 * evaluate the invariants, flatten the report. */

import ts from "typescript";
import type { ObjectLiteral } from "./ast.ts";
import { findAll, parseFile, propertyOf } from "./ast.ts";
import {
  collectOpsMaps,
  collectToolsMaps,
  resolveFn,
} from "./capability-maps.ts";
import { evaluateContract, extractWorkflow } from "./contract.ts";
import { collectEdgeWrites, collectPayloadWrites } from "./edge-payload.ts";
import type {
  CheckReport,
  SchemaCheckFile,
  WorkflowCheckResult,
} from "./report-types.ts";

export function checkDefinitionSources(files: SchemaCheckFile[]): CheckReport {
  const sourceFiles = files.map(parseFile);

  const opsMaps = collectOpsMaps(sourceFiles);
  const toolsMaps = collectToolsMaps(sourceFiles);
  const payloadWrites = collectPayloadWrites(sourceFiles);
  const fileByPath = new Map(sourceFiles.map((f) => [f.fileName, f]));

  const opsByName = new Map<string, ts.Node>();
  for (const [name, init] of opsMaps) {
    const containingFile =
      fileByPath.get(init.getSourceFile().fileName) ?? init.getSourceFile();
    opsByName.set(name, resolveFn(init, containingFile));
  }
  const toolsByName = new Map<string, ts.Node>();
  for (const [name, init] of toolsMaps) {
    const containingFile =
      fileByPath.get(init.getSourceFile().fileName) ?? init.getSourceFile();
    toolsByName.set(name, resolveFn(init, containingFile));
  }

  // Edge transforms from every flow definition in the files.
  const edgeWrites = new Map<string, Set<string>>();
  for (const file of sourceFiles) {
    const flowDefs = findAll(
      file,
      (n): n is ObjectLiteral =>
        ts.isObjectLiteralExpression(n) && propertyOf(n, "edges") !== undefined
    );
    for (const flowDef of flowDefs) {
      for (const [target, keys] of collectEdgeWrites(flowDef)) {
        const merged = edgeWrites.get(target) ?? new Set<string>();
        for (const key of keys) merged.add(key);
        edgeWrites.set(target, merged);
      }
    }
  }

  // Every defineWorkflow call in the files is a registered workflow.
  const workflows: WorkflowCheckResult[] = [];
  for (const file of sourceFiles) {
    const configs = findAll(file, (n): n is ObjectLiteral => {
      if (!ts.isObjectLiteralExpression(n)) return false;
      const parent = n.parent;
      if (parent === undefined || !ts.isCallExpression(parent)) {
        return false;
      }
      return (
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === "defineWorkflow"
      );
    });
    for (const config of configs) {
      const contract = extractWorkflow(
        config,
        sourceFiles,
        opsByName,
        toolsByName,
        edgeWrites,
        payloadWrites
      );
      const { errors, warnings } = evaluateContract(contract);
      workflows.push({
        workflowId: contract.workflowId,
        declared: contract.declared ? [...contract.declared].sort() : undefined,
        reads: [...contract.reads].sort(),
        writes: [...contract.writes].sort(),
        errors,
        warnings: [...warnings, ...contract.structure],
      });
    }
  }

  return {
    workflows,
    errors: workflows.flatMap((w) => w.errors),
    warnings: workflows.flatMap((w) => w.warnings),
  };
}
