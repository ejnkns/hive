/** @public — the definition-referenced module set and its gate: a definition
 * with file references materializes as a module set (the definition module as
 * the entry — references are by ref path, the entry imports nothing — plus
 * one file per reference), then lints each reference structurally, checks the
 * import policy, typechecks the whole set, verifies declared writes against
 * the actual executor bodies, and loads (import → validate → compile) — the
 * authoring-loop → runtime seam. Malformed references surface specific,
 * model-actionable findings; a valid set executes in a real FlowRuntime.
 *
 * Import from here, not from module-set/ directly. The pipeline pieces live
 * across the loader (materialize/load in flow-definitions), the
 * per-definition typechecker (typecheck-definition), and the module-set lint
 * and gate. */

export {
  readModuleSetFiles,
  runDefinitionModuleGate,
} from "./module-set/gate.ts";
export type { ModuleFinding } from "./module-set/lint.ts";
export { lintModuleSet } from "./module-set/lint.ts";
export type { WriteFinding } from "./module-set/verify-writes.ts";
export { verifyDeclaredWrites } from "./module-set/verify-writes.ts";
export { typecheckModuleSet } from "./typecheck-definition.ts";
