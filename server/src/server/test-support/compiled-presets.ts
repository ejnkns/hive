/** The compiled preset projections for behavior tests: each preset's
 * definition module loads through the real loader seam (import → validate →
 * compile) once, at module load, so the suites exercise the exact compiled
 * output the boot registers. */

import type { CompiledFlowDefinition } from "workflow-engine/workflow-types";
import { loadPresetDefinition } from "../preset-flow.ts";

export const queenBeeCompiled: CompiledFlowDefinition = (
  await loadPresetDefinition("queen-bee")
).flow;

export const wayfinderCompiled: CompiledFlowDefinition = (
  await loadPresetDefinition("wayfinder")
).flow;

export const honeycombCompiled: CompiledFlowDefinition = (
  await loadPresetDefinition("honeycomb")
).flow;

// The static workflows of each preset (the compiled projection is always
// static — the data form is; the union needs a guard at the access site).
export const queenBeeWorkflows =
  "workflows" in queenBeeCompiled ? queenBeeCompiled.workflows : [];
export const wayfinderWorkflows =
  "workflows" in wayfinderCompiled ? wayfinderCompiled.workflows : [];
export const honeycombWorkflows =
  "workflows" in honeycombCompiled ? honeycombCompiled.workflows : [];
