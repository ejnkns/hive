/** @private — the explicit-`any` pass: an explicit `any` in the definition
 * module or a referenced file disables the whole-set typecheck for that
 * position (the compiler's noImplicitAny only catches the *implicit* form),
 * so a module can smuggle broken state access (e.g. `task.workflowInstanceState`
 * on a `TaskDefinition`, which has no state methods) past the gate. Reject the
 * keyword outright: flow-authored modules are fully typed — `unknown`,
 * `Record<string, unknown>`, or the flow's own state type are the tools, never
 * `any`. */

import ts from "typescript";
import { moduleSetSources } from "./import-policy.ts";

export type AnyFinding = {
  // The file within the module set (relative path, e.g. "ops/build-brief.ts").
  file: string;
  line: number;
  column: number;
  message: string;
};

export function lintExplicitAny(dir: string): AnyFinding[] {
  const findings: AnyFinding[] = [];
  for (const [relPath, source] of moduleSetSources(dir)) {
    const sourceFile = ts.createSourceFile(
      relPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        );
        findings.push({
          file: relPath,
          line: line + 1,
          column: character + 1,
          message:
            'explicit "any" is not allowed in a definition module or referenced file — it disables the gate\'s typecheck; use "unknown", Record<string, unknown>, or the flow\'s own state type',
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return findings;
}
