/** @public — composition root: registers the built-in flow definitions the server ships. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { logger } from "shared/logger";
import { queenBeeBlueprint } from "../../../presets/queen-bee/blueprint.ts";
import { wayfinderBlueprint } from "../../../presets/wayfinder/blueprint.ts";
import { authoringSessionFlow } from "../server/flow-authoring.ts";
import type { FlowBlueprint } from "../server/flow-blueprint.ts";
import {
  findServerPackageRoot,
  loadDefinitionFromSource,
  registerFlowDefinition,
} from "../server/flow-definitions.ts";
import { renderFlowDefinition } from "../server/render-flow-definition.ts";

export async function registerBuiltinFlowDefinitions(): Promise<void> {
  // Built-ins are blueprint-defined flows: the design artifact renders into
  // the module set (entry + referenced files), which loads and registers with
  // blueprint + source + files — exactly like a user-generated flow, so the
  // library can offer a read-only "View" (blueprint + file tabs) instead of a
  // dead "Edit" for flows that ship with the server.
  await registerPresetFromBlueprint("queen-bee", queenBeeBlueprint);
  await registerPresetFromBlueprint("wayfinder", wayfinderBlueprint);
  // The flow-authoring session is a built-in definition but never shown in
  // the flow library — the definition editor drives it directly.
  registerFlowDefinition(authoringSessionFlow, { builtIn: true, hidden: true });
}

async function registerPresetFromBlueprint(
  presetName: string,
  blueprint: FlowBlueprint
): Promise<void> {
  // The renderer is pure (blueprint → TS); the referenced files ship with the
  // preset package and are read as the module set's `files` — the same shape a
  // rendered user definition stores. The loader's module-set path materializes
  // them next to the entry, so the entry's relative imports resolve.
  const rendered = renderFlowDefinition(blueprint);
  const files = readPresetModuleSetFiles(presetName);
  // The materialization dir is per-process (a pid-named runtime slug) so
  // concurrent boots — e.g. the e2e suites' parallel servers — never race on
  // the same server/.runtime/definitions/<slug> write (the loader's copy is
  // already nonce-named; the base write must be process-unique too). The
  // flowId re-stamps the loaded definition's id.
  const flow = await loadDefinitionFromSource(
    `${presetName}-boot-${process.pid}`,
    rendered.entry,
    presetName,
    files
  );
  registerFlowDefinition(flow, {
    builtIn: true,
    blueprint,
    source: rendered.entry,
    files,
  });
}

// Reads a preset package's referenced TypeScript sources as the module set's
// file map (relative path → source, `./`-prefixed like the module-set lint
// reports). The blueprint itself and the component-source module it embeds
// (queen-bee's ideas-card.ts) are design artifacts, not module-set members —
// the blueprint is stored separately on the definition record. Degrades to an
// empty set (a built-in without a viewable source) when the preset directory
// is not available (e.g. a packaged-only install).
function readPresetModuleSetFiles(presetName: string): Record<string, string> {
  const presetRoot = join(findServerPackageRoot(), "..", "presets", presetName);
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
        files[`./${relative(presetRoot, full).split("\\").join("/")}`] =
          readFileSync(full, "utf-8");
      }
    }
  };
  try {
    walk(presetRoot);
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
