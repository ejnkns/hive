/** @public — composition root: registers the built-in flow definitions the server ships. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { logger } from "shared/logger";
import { queenBeeFlow } from "../../../presets/queen-bee/flow.ts";
import { flow as wayfinderFlow } from "../../../presets/wayfinder/flow.ts";
import { authoringSessionFlow } from "../server/flow-authoring.ts";
import {
  findServerPackageRoot,
  registerFlowDefinition,
} from "../server/flow-definitions.ts";

export function registerBuiltinFlowDefinitions(): void {
  // Built-ins carry their module set (entry source + referenced files) the
  // same way user-generated flows do, so the library can offer a read-only
  // "View" instead of a dead "Edit" for flows that ship with the server.
  registerFlowDefinition(queenBeeFlow, {
    builtIn: true,
    ...readPresetModuleSet("queen-bee"),
  });
  registerFlowDefinition(wayfinderFlow, {
    builtIn: true,
    ...readPresetModuleSet("wayfinder"),
  });
  // The flow-authoring session is a built-in definition but never shown in
  // the flow library — the definition editor drives it directly.
  registerFlowDefinition(authoringSessionFlow, { builtIn: true, hidden: true });
}

// Reads a preset package's TypeScript source as a module set: the entry
// (flow.ts) plus every referenced module, keyed by its relative path — the
// same shape a rendered user definition stores. Degrades to nothing (a
// built-in without a viewable source) when the preset directory is not
// available (e.g. a packaged-only install).
function readPresetModuleSet(presetName: string): {
  source: string;
  files: Record<string, string>;
} {
  const presetRoot = join(findServerPackageRoot(), "..", "presets", presetName);
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files[relative(presetRoot, full).split("\\").join("/")] = readFileSync(
          full,
          "utf-8"
        );
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
    return { source: "", files: {} };
  }
  const source = files["flow.ts"] ?? "";
  delete files["flow.ts"];
  return { source, files };
}
