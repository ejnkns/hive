/** @public — the reverse renderer: a rendered-shape flow-definition entry
 * back into the FlowBlueprint that produced it. The parse mirrors the
 * renderer's emission exactly — every shape the renderer produces reverses
 * cleanly; a shape it never produces (a hand-written gate body, a hand-added
 * task `render` hint, a hand-added block) is reported as a
 * not-spec-representable finding naming the location, advisory and
 * model-actionable like `analyzeFlowBlueprint` findings.
 *
 * Pure, like the renderer: `parseFlowDefinition(entry, files?)` takes the
 * definition source (and, in the session, the referenced files) and returns
 * the blueprint plus findings — never throws. The session's adopt-manual-edits
 * handoff runs this over the current source + files to fold the human's edits
 * back into the blueprint (lossless where the edit is spec-representable).
 *
 * Import from here, not from parse-flow-definition/ directly. The
 * implementation lives in parse-flow-definition/: the literal readers (read),
 * the gate matcher (gates), the value-source and edge-transform matchers
 * (values), the completion-tool reader (completion), the reference inventory
 * and writes recovery (refs), and the finding report (findings). */

export type { ParseResult } from "./parse-flow-definition/parse.ts";
export { parseFlowDefinition } from "./parse-flow-definition/parse.ts";
