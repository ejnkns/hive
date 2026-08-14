/** @public — preset definition loading: a built-in preset is a checked-in
 * definition module (`presets/<name>/flow.ts`) plus its referenced modules.
 * The boot path and test harnesses load it through the same seam as a user
 * flow: import the module → validate → compile (the loader) → register. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "shared/logger";
import type {
  CompiledFlowDefinition,
  FlowDefinition,
} from "workflow-engine/workflow-types";
import {
  findServerPackageRoot,
  loadDefinitionFromSource,
} from "./flow-definitions.ts";

// The preset package root (`presets/<name>`), working from source and from
// the bundled dist.
export function presetRoot(presetName: string): string {
  return join(findServerPackageRoot(), "..", "presets", presetName);
}

// Reads a preset package's referenced TypeScript sources as the module set's
// file map (relative path → source, `./`-prefixed like the module-set lint
// reports). The definition module (flow.ts) and the design artifacts
// (blueprint.ts, the component-source module ideas-card.ts) are not module-set
// members. Degrades to an empty set (a built-in without viewable source) when
// the preset directory is not available (e.g. a packaged-only install).
export function readPresetModuleSetFiles(
  presetName: string
): Record<string, string> {
  const root = presetRoot(presetName);
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith(".ts") &&
        entry.name !== "blueprint.ts" &&
        entry.name !== "flow.ts" &&
        entry.name !== "ideas-card.ts"
      ) {
        files[
          `./${full
            .slice(root.length + 1)
            .split("\\")
            .join("/")}`
        ] = readFileSync(full, "utf-8");
      }
    }
  };
  try {
    walk(root);
  } catch (err) {
    logger.warn(
      `Preset "${presetName}" source unavailable (view will be empty): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return {};
  }
  return files;
}

// Loads a preset's definition module: reads `flow.ts` (the pure-data module)
// and the referenced files, then runs the loader seam (import → validate →
// compile). The materialization slug is per-process (a pid-named runtime
// slug) so concurrent boots — e.g. the e2e suites' parallel servers — never
// race on the same server/.runtime/definitions/<slug> write.
export async function loadPresetDefinition(
  presetName: string
): Promise<{ flow: CompiledFlowDefinition; definition?: FlowDefinition }> {
  const root = presetRoot(presetName);
  const source = readFileSync(join(root, "flow.ts"), "utf-8");
  const files = readPresetModuleSetFiles(presetName);
  return loadDefinitionFromSource(
    `${presetName}-boot-${process.pid}`,
    source,
    presetName,
    files
  );
}
