/** @private — the authoring session's state vocabulary: the item state the
 * session tools read and patch, the flow id, and the module-set working
 * directory. Only flow-authoring/session/* and the public session entry import
 * from here. */

import { join } from "node:path";
import { runtimeDefinitionsDir } from "../../flow-definitions.ts";

export const AUTHORING_DEFINITION_ID = "flow-authoring";

// The defensive fallback module-set key: real sessions record their flow id as
// the module-set slug (each session gets an isolated working directory), but a
// state without one (e.g. a bare unit-test state) still resolves somewhere
// instead of throwing.
export const AUTHORING_MODULE_SET = "__authoring__";

export function authoringModuleSetDir(slug: string): string {
  return join(runtimeDefinitionsDir(), slug);
}

export type AuthoringItemState = {
  // The user's original request (the session card's title).
  prompt?: string;
  // How this session was started: conversational asks clarifying questions and
  // drafts interactively; lucky produces the definition without questions.
  mode?: "conversational" | "lucky";
  // The definition module source (the single pure-data artifact the agent
  // writes and the human edits — the editor's Definition tab shows it).
  source?: string;
  // The referenced files of the current module set (relative path → source),
  // written by the file tools and saved with the definition.
  files?: Record<string, string>;
  // Definition-validation findings of the current source (fed back to the
  // agent by set_flow_definition; shown as draft notes in the editor).
  previewErrors?: string[];
  // The module-set gate findings of the last validate_definition call.
  gateErrors?: string[];
  // The gate outcome of the last validate_definition call.
  report?: {
    passed: boolean;
    attempts: number;
    errors: string[];
    warnings: string[];
  };
  // The parsed definition object of the current source (the editor binds its
  // Definition tab to it, so a structured-form panel can replace the raw
  // literal without re-plumbing).
  parsedDefinition?: unknown;
  // The definition's label — a suggested name for the saved definition.
  suggestedName?: string;
  // The registered definition id after a successful save. Written by the
  // save_definition tool (agent path) and the synchronous save route (the
  // editor's Save button) — both run the same saveAuthoringDefinition core.
  savedDefinitionId?: string;
  // The resolved display name of the saved definition (the suggested name or
  // the agent's explicit override).
  savedName?: string;
  // Non-blocking findings from the last save (the definition validator's
  // analysis — warnings the author may fix).
  saveFindings?: { errors: string[]; warnings: string[] };
  // The session's module-set working-directory key (its flow id, set at
  // session creation). Each session materializes, reads, and writes its own
  // module set under this key — referenced files never leak across sessions.
  moduleSetSlug?: string;
};
