/** @private — the adopt-manual-edits handoff: parse the session's current
 * definition source (with its referenced files) back into the blueprint, so
 * the agent continues with the human's edits folded in instead of the
 * discard-and-start-over path. Adoption is the session core both the agent
 * path and the editor's "Adopt edits" button share: it runs the reverse
 * renderer over `source` + `files`, re-renders the preview from the adopted
 * blueprint, and returns the state patch. Only flow-authoring/session.ts
 * (re-export) and the adopt route import from here. */

import {
  analyzeFlowBlueprint,
  validateFlowBlueprint,
} from "../../flow-blueprint.ts";
import { parseFlowDefinition } from "../../parse-flow-definition.ts";
import { renderFlowDefinition } from "../../render-flow-definition.ts";
import type { AuthoringItemState } from "./state.ts";

export type AdoptResult = {
  // The adopted blueprint, JSON-stringified for the editor's Blueprint tab.
  blueprint: string;
  // The re-rendered definition source of the adopted blueprint.
  previewSource: string;
  // Validation/analysis findings plus the parse's not-spec-representable
  // findings (what the hand edits could not be folded into the blueprint).
  previewErrors: string[];
  // The parse's not-spec-representable findings alone (the editor surfaces
  // them as the draft note; the agent sees what it cannot fold in).
  findings: string[];
};

// The instance-state patch both adoption paths apply on success, so the
// divergence clears and the agent's blueprint tools work again.
export function adoptPatch(
  result: AdoptResult
): Pick<
  AuthoringItemState,
  "blueprint" | "blueprintDiverged" | "previewSource" | "previewErrors"
> {
  return {
    blueprint: result.blueprint,
    blueprintDiverged: false,
    previewSource: result.previewSource,
    previewErrors: result.previewErrors,
  };
}

export function adoptAuthoringEdits(state: AuthoringItemState): AdoptResult {
  const source = typeof state.source === "string" ? state.source : "";
  if (source === "") {
    throw new Error(
      "Nothing to adopt — the session has no definition source. Ask the agent to generate one first."
    );
  }
  const parsed = parseFlowDefinition(source, state.files);
  const findings = parsed.findings;
  const validation = [
    ...validateFlowBlueprint(parsed.blueprint).map(
      (e) => `blueprint.${e.path}: ${e.message}`
    ),
    ...analyzeFlowBlueprint(parsed.blueprint).map(
      (finding) => `flow: ${finding}`
    ),
    ...findings,
  ];
  return {
    blueprint: JSON.stringify(parsed.blueprint, null, 2),
    previewSource: renderFlowDefinition(parsed.blueprint).entry,
    previewErrors: validation,
    findings,
  };
}
