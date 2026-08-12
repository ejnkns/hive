/** @private — the generation gate machinery: blueprint validation + live
 * preview, and the full module-set gate (render → materialize → lint →
 * import-policy → load → typecheck → schema check). The blueprint tools call
 * these; only flow-authoring/session/tools/* import from here. */

import {
  analyzeFlowBlueprint,
  type FlowBlueprint,
  validateFlowBlueprint,
} from "../../flow-blueprint.ts";
import { runModuleSetGate } from "../../module-set.ts";
import { renderFlowDefinition } from "../../render-flow-definition.ts";
import { AUTHORING_MODULE_SET } from "./state.ts";

// Validates + renders a blueprint for the live preview; returns the parsed
// blueprint and any findings. Used by both blueprint tools so the draft and
// the generated source never drift.
export type BlueprintPreview = {
  parsed: FlowBlueprint;
  previewSource: string;
  previewErrors: string[];
};

export function validateAndPreview(blueprintJson: string): BlueprintPreview {
  const parsed = JSON.parse(blueprintJson) as FlowBlueprint;
  const findings = [
    ...validateFlowBlueprint(parsed),
    ...analyzeFlowBlueprint(parsed).map((finding) => ({
      path: "flow",
      message: finding,
    })),
  ];
  if (findings.length > 0) {
    return {
      parsed,
      previewSource: "",
      previewErrors: findings.map((e) => `blueprint.${e.path}: ${e.message}`),
    };
  }
  try {
    return {
      parsed,
      previewSource: renderFlowDefinition(parsed).entry,
      previewErrors: [],
    };
  } catch (err) {
    return {
      parsed,
      previewSource: "",
      previewErrors: [
        `render failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

// The full generation gate: blueprint validation → render (entry + stubs) →
// materialize → lint → import policy → load → typecheck → schema check.
// Returns the entry, the current referenced files, and the findings.
export async function runGenerationGate(blueprint: FlowBlueprint): Promise<{
  source: string;
  files: Record<string, string>;
  errors: string[];
  warnings: string[];
}> {
  const blueprintWarnings = analyzeFlowBlueprint(blueprint);

  const rendered = renderFlowDefinition(blueprint);
  const result = await runModuleSetGate(
    AUTHORING_MODULE_SET,
    blueprint,
    rendered
  );
  return {
    source: rendered.entry,
    files: result.files,
    errors: result.errors,
    warnings: [...blueprintWarnings, ...result.warnings],
  };
}
