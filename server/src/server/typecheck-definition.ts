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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { runtimeDefinitionsDir } from "./flow-definitions";

export type TypecheckIssue = {
  code: number;
  message: string;
  line: number;
  column: number;
};

let tsconfigCache: ts.CompilerOptions | undefined;

// Read the server tsconfig (extends tsconfig.base.json) and reuse its
// compiler options — crucially the `paths` mapping that resolves bare
// `workflow-engine/*` imports to source. Cached: the tsconfig is static
// within a process.
function serverCompilerOptions(): ts.CompilerOptions {
  if (tsconfigCache) return tsconfigCache;
  const serverRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
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
  tsconfigCache = { ...parsed.options, noEmit: true };
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
