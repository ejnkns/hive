/** @private — the per-reference structural lint: file exists, path stays
 * within the definition root, the named export matches the declared contract.
 *
 * Each reference gets a transient harness file that imports its export and
 * assigns it to the contract type the engine declares (`GateContract`,
 * `readonly Tool[]`, `OperationFn`, `TransformContract`, `OutputExtractor`).
 * One TS program over all harnesses surfaces two specific findings: a missing
 * export ("has no exported member") and a contract mismatch (not assignable).
 * Diagnostics attributed to the referenced files themselves are left to the
 * whole-set typecheck — the lint reports per-reference structure, not the
 * file's own type errors. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { DefinitionReference } from "workflow-engine/compile-flow-definition";
import { isRefWithinRoot } from "../flow-definition.ts";
import { refPathInDir } from "../flow-definitions.ts";
import { serverCompilerOptions } from "../typecheck-definition.ts";

export type ModuleFinding = {
  kind: DefinitionReference["kind"];
  ref: string;
  // The definition path of the reference (e.g. "workflows[0].states[1].autoTransitions[0].gate").
  path: string;
  message: string;
};

export function lintModuleSet(
  refs: readonly DefinitionReference[],
  dir: string
): ModuleFinding[] {
  const findings: ModuleFinding[] = [];
  const harnessDir = join(dir, "__lint__");
  const harnessByFile = new Map<string, DefinitionReference>();
  const harnessFiles: string[] = [];
  let index = 0;

  for (const ref of refs) {
    const target = refPathInDir(dir, ref.ref);
    if (target === undefined || !isRefWithinRoot(ref.ref)) {
      findings.push({
        kind: ref.kind,
        ref: ref.ref,
        path: ref.path,
        message: `referenced file ${ref.ref} is outside the definition root — reference paths must stay inside the module-set directory`,
      });
      continue;
    }
    if (!existsSync(target)) {
      findings.push({
        kind: ref.kind,
        ref: ref.ref,
        path: ref.path,
        message: `referenced file ${ref.ref} does not exist — create it or fix the path`,
      });
      continue;
    }

    const file = join(harnessDir, `${index}.ts`);
    mkdirSync(harnessDir, { recursive: true });
    writeFileSync(file, harnessSource(ref), "utf-8");
    harnessFiles.push(file);
    harnessByFile.set(file, ref);
    index += 1;
  }

  if (harnessFiles.length === 0) return findings;

  const program = ts.createProgram(harnessFiles, serverCompilerOptions());
  const messagesByFile = new Map<string, string[]>();
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || !harnessByFile.has(diagnostic.file.fileName)) {
      continue;
    }
    const list = messagesByFile.get(diagnostic.file.fileName) ?? [];
    list.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    messagesByFile.set(diagnostic.file.fileName, list);
  }
  for (const [file, messages] of messagesByFile) {
    const ref = harnessByFile.get(file);
    if (!ref) continue;
    const detail = messages.join("; ");
    const message = detail.includes("has no exported member")
      ? `referenced file ${ref.ref} does not export "${ref.exportName}" — the entry imports that exact name (${detail})`
      : ref.kind === "component" && detail.includes("has no default export")
        ? `referenced file ${ref.ref} does not export a default factory — the served component contract is a default-export factory (${detail})`
        : `export "${ref.exportName}" in ${ref.ref} does not match the ${ref.kind} contract: ${detail}`;
    findings.push({ kind: ref.kind, ref: ref.ref, path: ref.path, message });
  }
  return findings;
}

// The harness imports the reference's export and pins it to the contract
// type. The harness lives in the module set's `__lint__/` directory, so the
// import specifier is `../`-prefixed against the module-set root.
function harnessSource(ref: DefinitionReference): string {
  const relativeRef = ref.ref.startsWith("./") ? ref.ref.slice(2) : ref.ref;
  const specifier = `../${relativeRef}`;
  switch (ref.kind) {
    case "gate":
      return `import { ${ref.exportName} } from "${specifier}";\nimport type { GateContract } from "workflow-engine/workflow-types";\nconst _check: GateContract = ${ref.exportName};\n`;
    case "tool":
      return `import { ${ref.exportName} } from "${specifier}";\nimport type { Tool } from "workflow-engine/runners";\nconst _check: readonly Tool[] = ${ref.exportName};\n`;
    case "operation":
      return `import { ${ref.exportName} } from "${specifier}";\nimport type { OperationFn } from "workflow-engine/runners";\nconst _check: OperationFn = ${ref.exportName}.${ref.id};\n`;
    case "transform":
      return `import { ${ref.exportName} } from "${specifier}";\nimport type { TransformContract } from "workflow-engine/workflow-types";\nconst _check: TransformContract = ${ref.exportName};\n`;
    case "extract":
      return `import { ${ref.exportName} } from "${specifier}";\nimport type { OutputExtractor } from "workflow-engine/workflow-types";\nconst _check: OutputExtractor = ${ref.exportName};\n`;
    case "prompt":
      // The prompt contract is a plain string const; only a missing export or
      // a non-string export fails the lint (an empty TODO stub passes — the
      // prompt-less analysis catches a task that never gets its prompt).
      return `import { ${ref.exportName} } from "${specifier}";\nconst _check: string = ${ref.exportName};\n`;
    case "component":
      // The served-module contract: a default-export factory receiving the
      // app's lit runtime. The harness pins the default export to the
      // contract type (a missing default export surfaces as "has no default
      // export"; a non-factory as a contract mismatch).
      return `import factory from "${specifier}";\nimport type { FlowComponentModule } from "workflow-engine/workflow-types";\nconst _check: NonNullable<FlowComponentModule["default"]> = factory;\n`;
  }
}
