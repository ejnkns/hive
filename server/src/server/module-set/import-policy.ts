/** @private — the import policy for definition-referenced modules: a file in
 * the module set may import engine primitives (`workflow-engine/*`), the
 * flow's own files (relative imports staying inside the module set), `node:`
 * builtins, and packages declared in the definition's `dependencies`. Anything
 * else is rejected with a readable, model-actionable finding — the declaration
 * is the legibility (the flow's capabilities are readable from the
 * definition), the gate is the enforcement. */

import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export type ImportFinding = {
  // The file within the module set (relative path, e.g. "gates/approved.ts").
  file: string;
  // The offending import specifier.
  specifier: string;
  message: string;
};

export function lintImportPolicy(
  dependencies: string[],
  dir: string
): ImportFinding[] {
  const findings: ImportFinding[] = [];
  const declared = new Set(dependencies);
  const root = resolve(dir);
  for (const [relPath, source] of moduleSetSources(dir)) {
    const sourceFile = ts.createSourceFile(
      relPath,
      source,
      ts.ScriptTarget.Latest,
      true
    );
    for (const specifier of collectSpecifiers(sourceFile)) {
      const verdict = importVerdict(
        specifier,
        declared,
        join(root, relPath),
        root
      );
      if (!verdict.ok) {
        findings.push({ file: relPath, specifier, message: verdict.message });
      }
    }
  }
  return findings;
}

function importVerdict(
  specifier: string,
  declared: Set<string>,
  importingFile: string,
  root: string
): { ok: boolean; message: string } {
  // The flow's own files: relative imports must stay inside the module set.
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const target = resolve(dirname(importingFile), specifier);
    if (!target.startsWith(root + sep)) {
      return {
        ok: false,
        message: `relative import "${specifier}" resolves outside the module set — imports may only reach the flow's own files`,
      };
    }
    return { ok: true, message: "" };
  }
  // node: builtins and bare builtin names (fs, path, ...), including
  // builtin subpaths like "fs/promises".
  if (isBuiltin(specifier) || isBuiltin(specifier.split("/")[0] ?? specifier)) {
    return { ok: true, message: "" };
  }
  // Engine primitives.
  if (
    specifier === "workflow-engine" ||
    specifier.startsWith("workflow-engine/")
  ) {
    return { ok: true, message: "" };
  }
  // Declared dependencies, matched by package name (any subpath of a declared
  // package is allowed).
  const pkg = packageNameOf(specifier);
  if (declared.has(pkg)) {
    return { ok: true, message: "" };
  }
  return {
    ok: false,
    message: `imports "${specifier}" which is not declared in the definition's dependencies — add "${pkg}" to the dependencies list or remove the import`,
  };
}

// The package name an import specifier refers to: the first path segment
// (first two for scoped packages), so "lodash/fp" → "lodash" and
// "@scope/pkg/sub" → "@scope/pkg".
function packageNameOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

// Every .ts file under the module-set dir (excluding the lint's transient
// `__lint__` harnesses), as relative-path → source. The entry is included —
// it is renderer-generated (only engine + ref imports) but the policy holds
// every file to the same standard.
function moduleSetSources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (sub: string): void => {
    for (const entry of readdirSync(sub, { withFileTypes: true })) {
      if (entry.name === "__lint__") continue;
      const full = join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push([
          relative(dir, full).split(sep).join("/"),
          readFileSync(full, "utf-8"),
        ]);
      }
    }
  };
  walk(dir);
  return out;
}

// Static imports, side-effect imports, re-exports, and dynamic import() calls.
function collectSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}
