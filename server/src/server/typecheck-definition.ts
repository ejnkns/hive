/** @public — per-definition TypeScript checking through the compiler API.
 *
 * Node's native type-stripping (`stripTypeScriptTypes`) transpiles user
 * definitions without checking them — "compiles" for a user flow means
 * "loads", not "typechecks". This module closes that gap: a single-file
 * program over the definition's materialized working copy (same
 * server/.runtime/definitions location the loader imports) using the server
 * tsconfig's module resolution, so `workflow-engine/*` imports resolve to
 * source and the definition's uses of the authoring types are checked.
 *
 * Only diagnostics attributed to the definition file itself are returned —
 * the engine sources it imports are typechecked by the repo's full typecheck,
 * and surfacing their internal errors here would be noise.
 *
 * This is the "compiles" half of the correctness gate for generated and saved
 * definitions, and the same machinery the editor-depth initiative will reuse
 * for inline underlines. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  findServerPackageRoot,
  runtimeDefinitionsDir,
} from "./flow-definitions.ts";

export type TypecheckIssue = {
  code: number;
  message: string;
  line: number;
  column: number;
  // The file within a module set the issue belongs to (relative to the module
  // set root); undefined for the single-file check.
  file?: string;
};

let tsconfigCache: ts.CompilerOptions | undefined;

// Read the server tsconfig (extends tsconfig.base.json) and reuse its
// compiler options — crucially the `paths` mapping that resolves bare
// `workflow-engine/*` imports to source. Cached: the tsconfig is static
// within a process. Exported for the module-set lint, which typechecks the
// same resolution against the per-reference contract harnesses.
export function serverCompilerOptions(): ts.CompilerOptions {
  if (tsconfigCache) return tsconfigCache;
  // The server package root (same resolution the loader uses, working from
  // source and from the bundled dist) — the tsconfig lives there.
  const serverRoot = findServerPackageRoot();
  const tsconfigPath = join(serverRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    serverRoot
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
        .join("; ")
    );
  }
  // The tsconfig's `types: ["node"]` only resolves when the program can find
  // @types/node. parseJsonConfigFileContent leaves typeRoots unset (the
  // default then walks up from the process cwd, which is the repo root under
  // plain node — not the server package), so node: builtins in a module set
  // fail with "Cannot find type definition file for 'node'". Pin typeRoots to
  // the server package's own node_modules/@types so the per-definition checker
  // resolves the same builtins the loader does.
  tsconfigCache = {
    ...parsed.options,
    noEmit: true,
    typeRoots: parsed.options.typeRoots ?? [
      join(serverRoot, "node_modules", "@types"),
    ],
  };
  return tsconfigCache;
}

export function typecheckDefinitionSource(
  source: string,
  runtimeSlug: string
): TypecheckIssue[] {
  const dir = runtimeDefinitionsDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${runtimeSlug}.ts`);
  writeFileSync(filePath, source, "utf-8");

  const program = ts.createProgram([filePath], serverCompilerOptions());
  const issues: TypecheckIssue[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || diagnostic.file.fileName !== filePath) continue;
    const position = diagnostic.start ?? 0;
    const { line, character } =
      diagnostic.file.getLineAndCharacterOfPosition(position);
    issues.push({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line: line + 1,
      column: character + 1,
    });
  }
  return issues;
}

// Typechecks a whole module set: the entry and every referenced file in the
// materialized directory (the lint's transient `__lint__` harnesses are
// excluded). Diagnostics are attributed to the file they belong to — an
// engine source pulled in by an import is not the definition's own error.
export function typecheckModuleSet(
  dir: string,
  _slug: string
): TypecheckIssue[] {
  const files = moduleSetFilesIn(dir);
  const program = ts.createProgram(
    Object.keys(files).map((rel) => join(dir, rel)),
    serverCompilerOptions()
  );
  const root = resolve(dir) + sep;
  const issues: TypecheckIssue[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file) continue;
    const fileName = diagnostic.file.fileName;
    if (!fileName.startsWith(root)) continue;
    const position = diagnostic.start ?? 0;
    const { line, character } =
      diagnostic.file.getLineAndCharacterOfPosition(position);
    issues.push({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line: line + 1,
      column: character + 1,
      file: relative(dir, fileName).split(sep).join("/"),
    });
  }
  return issues;
}

// Every .ts file under the module-set directory (flow.ts + referenced files),
// excluding the lint's transient harness directory.
function moduleSetFilesIn(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (sub: string): void => {
    for (const entry of readdirSync(sub, { withFileTypes: true })) {
      const full = join(sub, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__lint__") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files[relative(dir, full).split(sep).join("/")] = readFileSync(
          full,
          "utf-8"
        );
      }
    }
  };
  walk(dir);
  return files;
}
