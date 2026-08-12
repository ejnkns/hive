/** @private — the module-set gate: the authoring-loop → runtime seam for a
 * blueprint with file references. Orchestrates validate (caller) → render
 * (caller) → materialize → lint → load → typecheck → schema-consistency, and
 * returns the current file set so the caller can store it on the definition
 * record. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { FlowBlueprint } from "../flow-blueprint.ts";
import {
  loadModuleSetDefinition,
  materializeModuleSet,
} from "../flow-definitions.ts";
import type { RenderedModuleSet } from "../render-flow-definition.ts";
import { checkDefinitionSources } from "../schema-consistency.ts";
import { typecheckModuleSet } from "../typecheck-definition.ts";
import { lintImportPolicy } from "./import-policy.ts";
import { lintModuleSet } from "./lint.ts";

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
  const findings = lintModuleSet(blueprint, dir);
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
  const importFindings = lintImportPolicy(blueprint, dir);
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
