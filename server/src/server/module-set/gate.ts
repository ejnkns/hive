/** @private — the module-set gate: the authoring-loop → runtime seam for a
 * definition with file references.
 *
 * Two entry points share the machinery:
 *  - `runModuleSetGate` (legacy): the two-artifact blueprint → rendered module
 *    set path, kept for the renderer corpus and preset boot until deletion.
 *  - `runDefinitionModuleGate` (the definition world): a pure-data definition
 *    module + its referenced files. Orchestrates validate (the definition
 *    validator, in the caller) → lint → import policy → typecheck →
 *    declared-writes verification → load (import → validate → compile), and
 *    returns the compiled flow plus the current file set. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { collectDefinitionRefs } from "workflow-engine/compile-flow-definition";
import type { FlowDefinition } from "workflow-engine/workflow-types";
import type { FlowBlueprint } from "../flow-blueprint.ts";
import { collectModuleReferences } from "../flow-blueprint.ts";
import {
  loadDefinitionFromSource,
  loadModuleSetDefinition,
  materializeModuleSet,
  writeModuleSetDir,
} from "../flow-definitions.ts";
import type { RenderedModuleSet } from "../render-flow-definition.ts";
import { checkDefinitionSources } from "../schema-consistency.ts";
import { typecheckModuleSet } from "../typecheck-definition.ts";
import { lintImportPolicy } from "./import-policy.ts";
import { lintModuleSet } from "./lint.ts";
import { verifyDeclaredWrites } from "./verify-writes.ts";

export type ModuleGateResult = {
  // The materialized module-set directory.
  dir: string;
  // The current on-disk referenced files (relative path → source), so the
  // caller can persist the set on the definition record.
  files: Record<string, string>;
  // Model-actionable findings, formatted per stage.
  errors: string[];
  warnings: string[];
  // The loaded definition, present when every stage passed.
  flow?: Awaited<ReturnType<typeof loadModuleSetDefinition>>;
};

export async function runModuleSetGate(
  runtimeSlug: string,
  blueprint: FlowBlueprint,
  rendered: RenderedModuleSet
): Promise<ModuleGateResult> {
  const dir = materializeModuleSet(runtimeSlug, rendered);

  // 1. Per-reference structural lint (missing file, escaping path, export,
  //    contract) — the file set's own gate, before anything loads.
  const findings = lintModuleSet(collectModuleReferences(blueprint), dir);
  if (findings.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: findings.map((f) => `module ${f.ref}: ${f.message}`),
      warnings: [],
    };
  }

  // 1b. Import policy: engine primitives, the flow's own files, node:
  //     builtins, and declared dependencies only.
  const importFindings = lintImportPolicy(blueprint.dependencies ?? [], dir);
  if (importFindings.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: importFindings.map((f) => `import ${f.file}: ${f.message}`),
      warnings: [],
    };
  }

  // 2. Transpile + load (the runtime surface).
  let flow: ModuleGateResult["flow"];
  try {
    flow = await loadModuleSetDefinition(dir);
  } catch (err) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: [
        `The generated definition failed to load: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      warnings: [],
    };
  }

  // 3. Whole-set typecheck (the entry and every referenced file), with each
  //    diagnostic attributed to its file.
  const typeIssues = typecheckModuleSet(dir, runtimeSlug);
  if (typeIssues.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: typeIssues.map((i) => {
        const where = i.file
          ? `${i.file}:${i.line}:${i.column}`
          : `${i.line}:${i.column}`;
        return `typecheck ${where} — ${i.message}`;
      }),
      warnings: [],
    };
  }

  // 4. Schema consistency over the whole set.
  const files = readModuleSetFiles(dir);
  const check = checkDefinitionSources([
    { path: "flow.ts", source: rendered.entry },
    ...Object.entries(files).map(([path, source]) => ({ path, source })),
  ]);
  return {
    dir,
    files,
    errors: [...check.errors],
    warnings: [...check.warnings],
    flow,
  };
}

// The definition-world gate: a definition module + referenced files → the
// compiled flow, or the stage findings. The definition validator (the
// declared-parts checks) runs in the caller; this gate covers the referenced
// modules — the same lint/import-policy/typecheck machinery, the
// declared-writes verification (declarations can lie), and the load (import →
// validate → compile → the runtime surface).
export async function runDefinitionModuleGate(
  runtimeSlug: string,
  definition: FlowDefinition,
  source: string,
  refFiles: Record<string, string>
): Promise<{
  dir: string;
  files: Record<string, string>;
  errors: string[];
  warnings: string[];
  flow?: Awaited<ReturnType<typeof loadDefinitionFromSource>>["flow"];
}> {
  const dir = writeModuleSetDir(runtimeSlug, {
    entry: source,
    files: refFiles,
  });

  // 1. Per-reference structural lint (missing file, escaping path, export,
  //    contract).
  const findings = lintModuleSet(collectDefinitionRefs(definition), dir);
  if (findings.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: findings.map((f) => `module ${f.ref}: ${f.message}`),
      warnings: [],
    };
  }

  // 1b. Import policy.
  const importFindings = lintImportPolicy(definition.dependencies ?? [], dir);
  if (importFindings.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: importFindings.map((f) => `import ${f.file}: ${f.message}`),
      warnings: [],
    };
  }

  // 2. Whole-set typecheck (the definition module + every referenced file).
  const typeIssues = typecheckModuleSet(dir, runtimeSlug);
  if (typeIssues.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: typeIssues.map((i) => {
        const where = i.file
          ? `${i.file}:${i.line}:${i.column}`
          : `${i.line}:${i.column}`;
        return `typecheck ${where} — ${i.message}`;
      }),
      warnings: [],
    };
  }

  // 3. Declared tool/op writes vs the actual executor bodies (declarations
  //    can lie — the read↔write invariant counts only what really patches).
  const writeFindings = verifyDeclaredWrites(definition, refFiles);
  if (writeFindings.length > 0) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: writeFindings.map((f) => `writes ${f.ref}: ${f.message}`),
      warnings: [],
    };
  }

  // 4. Load: import the module, validate, compile with the ref resolver —
  //    the runtime surface.
  try {
    const loaded = await loadDefinitionFromSource(
      runtimeSlug,
      source,
      undefined,
      readModuleSetFiles(dir)
    );
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: [],
      warnings: [],
      flow: loaded.flow,
    };
  } catch (err) {
    return {
      dir,
      files: readModuleSetFiles(dir),
      errors: [
        `The definition failed to load: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      warnings: [],
    };
  }
}

// The reference inventory of a data definition (the engine's collect walks
// the data form; the lint consumes the same shape as the blueprint's).

// The current referenced files of a materialized module-set directory (the
// entry's relative paths as declared, e.g. "./gates/approved.ts"; the lint's
// transient `__lint__` harnesses and the entry itself are excluded — the
// entry is the definition's `source`).
export function readModuleSetFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const root = resolve(dir);
  const walk = (sub: string): void => {
    for (const entry of readdirSync(sub, { withFileTypes: true })) {
      if (entry.name === "__lint__") continue;
      const full = join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && full !== join(root, "flow.ts")) {
        files[`./${relative(dir, full).split(sep).join("/")}`] = readFileSync(
          full,
          "utf-8"
        );
      }
    }
  };
  walk(dir);
  return files;
}
