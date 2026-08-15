/** @public — the flow definition authoring surface: the definition parser
 * (a definition module → the data FlowDefinition object) and the definition
 * validator (the declared-parts checks on the parsed definition).
 * Import from here, not from flow-definition/ directly.
 *
 * The definition is the single pure-data artifact: what an agent writes, a UI
 * builder edits, the validator checks, and the engine compiles at registration
 * (compileFlowDefinition in workflow-engine). The loader imports the module
 * for the canonical object; this parser reads the same shape from source
 * without executing it — the editor's Definition tab binds to the parsed
 * object so a structured-form panel can later replace the raw literal without
 * re-plumbing. */

export { type ParseResult, parseDefinition } from "./flow-definition/parse.ts";
export { parseEntrySource } from "./flow-definition/read.ts";
export { isRefWithinRoot, validateRefShape } from "./flow-definition/ref.ts";
export {
  analyzeFlowDefinition,
  validateFlowDefinition,
} from "./flow-definition/validator.ts";
