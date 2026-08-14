/** @public — the schema-consistency check as a service: AST-based validation
 * that a flow definition's reads and writes respect its declared
 * workflowInstanceState contract. Import from here, not from
 * schema-consistency/ directly.
 *
 * Asserts, per workflow: the anchor exists, every authored write is a declared
 * field (writes ⊆ declared), and every read has a writer (reads ⊆ writes ∪
 * engine-provided). Dead declarations and write-without-read fields surface as
 * warnings; state-machine structure (reachability, exit) is advisory.
 *
 * The implementation lives in schema-consistency/: the AST helpers (ast), the
 * read/write extraction passes (state-access, anchors, edge-payload,
 * capability-maps), the structural-soundness pass (structure), the per-flow
 * contract + invariant evaluation (contract), and the orchestrating check
 * (check). */

// The AST helpers and state-access extraction passes, shared with the reverse
// renderer (parse-flow-definition): the parse reads a rendered definition's
// literals and recovers the tool/op `writes` declarations from the referenced
// files with the same extraction the check itself uses, so the recovered
// writes always match the actual executor bodies. Import from here, not from
// schema-consistency/ directly.
export type { ObjectLiteral } from "./schema-consistency/ast.ts";
export { parseFile, unwrap } from "./schema-consistency/ast.ts";
export { resolveFn } from "./schema-consistency/capability-maps.ts";
export { checkDefinitionSources } from "./schema-consistency/check.ts";
export type {
  CheckReport,
  SchemaCheckFile,
  WorkflowCheckResult,
} from "./schema-consistency/report-types.ts";
export {
  collectPatchWrites,
  collectStateReads,
} from "./schema-consistency/state-access.ts";
