/** @private — the schema-consistency AST utilities, shared by the definition
 * parser and the module-set declared-writes verification. The read↔write
 * invariant itself now lives in the definition validator
 * (flow-definition/writers.ts) and the declared-writes pass
 * (module-set/verify-writes.ts); the closure-form workflow-contract check
 * that used these AST helpers was retired with the definition-as-data
 * migration. Import from here, not from schema-consistency/ directly. */

export type { ObjectLiteral } from "./schema-consistency/ast.ts";
export { parseFile, unwrap } from "./schema-consistency/ast.ts";
export { resolveFn } from "./schema-consistency/capability-maps.ts";
export {
  collectFlowStatePatchWrites,
  collectPatchWrites,
  collectSiblingPatchWrites,
} from "./schema-consistency/state-access.ts";
