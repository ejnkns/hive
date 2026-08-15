/** @private — the definition gate machinery: definition-module validation
 * (the definition parser + validator for the live preview) and the full
 * module-set gate (materialize → lint → import-policy → typecheck →
 * declared-writes → load). The definition tools call these; only
 * flow-authoring/session/tools/* import from here. */

import type { FlowDefinition } from "workflow-engine/workflow-types";
import {
  analyzeFlowDefinition,
  parseDefinition,
  validateFlowDefinition,
} from "../../flow-definition.ts";
import { runDefinitionModuleGate } from "../../module-set.ts";

// Parses + validates a definition module for the live preview; returns the
// parsed definition and any findings. Used by both definition tools so the
// source and the findings never drift.
export type DefinitionPreview = {
  parsed: FlowDefinition;
  previewErrors: string[];
};

export function validateAndPreview(source: string): DefinitionPreview {
  const { definition, findings } = parseDefinition(source);
  const validation = [
    ...validateFlowDefinition(definition).map(
      (e) => `definition.${e.path}: ${e.message}`
    ),
    ...analyzeFlowDefinition(definition).map((finding) => `flow: ${finding}`),
  ];
  return {
    parsed: definition,
    previewErrors: [...validation, ...findings],
  };
}

// The full definition gate: definition validation → materialize → lint →
// import policy → typecheck → declared-writes verification → load (import →
// validate → compile). Returns the loaded compiled flow, the current
// referenced files, and the findings. The module-set slug names the session's
// own working directory (its flow id), so concurrent sessions never share or
// clobber each other's referenced files.
export async function runDefinitionGate(
  definition: FlowDefinition,
  source: string,
  moduleSetSlug: string,
  files: Record<string, string>
): Promise<{
  files: Record<string, string>;
  errors: string[];
  warnings: string[];
  flow?: Awaited<ReturnType<typeof runDefinitionModuleGate>>["flow"];
}> {
  const result = await runDefinitionModuleGate(
    moduleSetSlug,
    definition,
    source,
    files
  );
  return {
    files: result.files,
    errors: result.errors,
    warnings: result.warnings,
    flow: result.flow,
  };
}
