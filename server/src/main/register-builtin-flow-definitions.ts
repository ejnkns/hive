/** @public — composition root: registers the built-in flow definitions the server ships. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authoringSessionFlow } from "../server/flow-authoring.ts";
import { registerFlowDefinition } from "../server/flow-definitions.ts";
import {
  loadPresetDefinition,
  presetRoot,
  readPresetModuleSetFiles,
} from "../server/preset-flow.ts";

export async function registerBuiltinFlowDefinitions(): Promise<void> {
  // Built-ins are definition modules: the pure-data artifact ships with the
  // preset package, and the boot path loads it through the same seam as a
  // user flow — import → validate → compile → register — carrying both the
  // compiled projection (what runs) and the data form (the library view).
  await registerPresetDefinition("queen-bee");
  await registerPresetDefinition("wayfinder");
  // The flow-authoring session is a built-in definition but never shown in
  // the flow library — the definition editor drives it directly.
  registerFlowDefinition(authoringSessionFlow, { builtIn: true, hidden: true });
}

async function registerPresetDefinition(presetName: string): Promise<void> {
  const loaded = await loadPresetDefinition(presetName);
  const source = readFileSync(join(presetRoot(presetName), "flow.ts"), "utf-8");
  registerFlowDefinition(loaded.flow, {
    builtIn: true,
    definition: loaded.definition,
    source,
    files: readPresetModuleSetFiles(presetName),
  });
}
