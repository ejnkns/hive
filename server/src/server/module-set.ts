/** @public — the blueprint-referenced module set and its gate: a blueprint
 * with file references renders as a module set (the entry wiring the
 * references via imports, plus one contract-typed stub per reference), then
 * materializes, lints each reference structurally, loads, typechecks the whole
 * set, and passes the schema-consistency check — the authoring-loop → runtime
 * seam. Malformed references surface specific, model-actionable findings; a
 * valid set executes in a real FlowRuntime.
 *
 * Import from here, not from module-set/ directly. The pipeline pieces live
 * across the loader (materialize/load in flow-definitions), the per-definition
 * typechecker (typecheck-definition), and the module-set lint and gate. */

export {
  loadModuleSetDefinition,
  materializeModuleSet,
} from "./flow-definitions.ts";
export type { ModuleGateResult } from "./module-set/gate.ts";
export {
  readModuleSetFiles,
  runModuleSetGate,
} from "./module-set/gate.ts";
export type { ModuleFinding } from "./module-set/lint.ts";
export { lintModuleSet } from "./module-set/lint.ts";
export type { RenderedModuleSet } from "./render-flow-definition.ts";
export { typecheckModuleSet } from "./typecheck-definition.ts";
