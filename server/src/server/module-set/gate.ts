/** @private — the definition-world module-set gate: a definition module +
 * its referenced files → the compiled flow, or the stage findings. The
 * definition validator (the declared-parts checks) runs in the caller; this
 * gate covers the referenced modules — materialize → lint → import policy →
 * typecheck → declared-writes verification → load (import → validate →
 * compile). Malformed references surface specific, model-actionable findings;
 * a valid set executes in a real FlowRuntime. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { collectDefinitionRefs } from "workflow-engine/compile-flow-definition";
import type { FlowDefinition } from "workflow-engine/workflow-types";
import {
  loadDefinitionFromSource,
  writeModuleSetDir,
} from "../flow-definitions.ts";
import { typecheckModuleSet } from "../typecheck-definition.ts";
import { lintImportPolicy } from "./import-policy.ts";
import { lintModuleSet } from "./lint.ts";
import { verifyDeclaredWrites } from "./verify-writes.ts";

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
  const importFindings = lintImportPolicy(
    definition.dependencies ?? [],
    dir,
    collectDefinitionRefs(definition)
  );
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
