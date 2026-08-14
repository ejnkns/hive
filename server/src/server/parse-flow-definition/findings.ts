/** @private — the not-spec-representable report: every hand-written shape the
 * renderer never emits lands here as a location-named finding. Findings are
 * advisory and model-actionable (like analyzeFlowBlueprint findings); the
 * representable rest of the definition is still recovered. */

export type FindingSink = string[];

// A hand-written shape the renderer never emits: the definition cannot be
// folded back into the blueprint vocabulary at this location.
export function notSpecRepresentable(
  findings: FindingSink,
  path: string,
  detail: string
): void {
  findings.push(`${path}: not spec-representable — ${detail}`);
}

// A structural problem the parse cannot recover from (a missing anchor, a
// malformed emission): the definition deviates from the renderer's contract.
export function unreadable(
  findings: FindingSink,
  path: string,
  detail: string
): void {
  findings.push(`${path}: ${detail}`);
}
