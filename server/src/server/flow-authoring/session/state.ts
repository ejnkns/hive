/** @private — the authoring session's state vocabulary: the item state the
 * session tools read and patch, the flow id, and the module-set working
 * directory. Only flow-authoring/session/* and the public session entry import
 * from here. */

import { join } from "node:path";
import { runtimeDefinitionsDir } from "../../flow-definitions.ts";

export const AUTHORING_DEFINITION_ID = "flow-authoring";

// The session's module-set working directory under the runtime definitions
// root: the gate materializes the entry + stubs here, and the file tools read
// and write the referenced files here (hand edits are authoritative).
export const AUTHORING_MODULE_SET = "__authoring__";

export function authoringModuleSetDir(): string {
  return join(runtimeDefinitionsDir(), AUTHORING_MODULE_SET);
}

export type AuthoringItemState = {
  // The user's original request (the session card's title).
  prompt?: string;
  // How this session was started: conversational asks clarifying questions and
  // drafts interactively; lucky produces the blueprint without questions.
  mode?: "conversational" | "lucky";
  // The current FlowBlueprint draft, maintained by the agent via set_flow_blueprint.
  blueprint?: string;
  // The rendered TypeScript of the current draft (live preview in the editor).
  previewSource?: string;
  // Validation/render findings of the current draft (fed back to the agent).
  previewErrors?: string[];
  // The gate findings of the last generate_definition call.
  gateErrors?: string[];
  // The gate outcome of the last generate_definition call.
  report?: {
    passed: boolean;
    attempts: number;
    errors: string[];
    warnings: string[];
  };
  // The gate-passed TypeScript source (written by generate_definition). For a
  // blueprint with file references this is the module-set entry (flow.ts); the
  // referenced files live in `files`.
  source?: string;
  // The referenced files of the current module set (relative path → source),
  // written by generate_definition and saved with the definition.
  files?: Record<string, string>;
  // The blueprint's label — a suggested name for the saved definition.
  suggestedName?: string;
  // The registered definition id after a successful save. Written by the
  // save_definition tool (agent path) and the synchronous save route (the
  // editor's Save button) — both run the same saveAuthoringDefinition core.
  savedDefinitionId?: string;
  // The resolved display name of the saved definition (the suggested name or
  // the agent's explicit override).
  savedName?: string;
  // Non-blocking schema-consistency findings from the last save.
  saveFindings?: { errors: string[]; warnings: string[] };
  // True while the human has edited the definition TS directly (the editor's
  // write-back). The blueprint draft is frozen: set_flow_blueprint/generate_definition
  // refuse until the human discards (or adopts, via the future reverse
  // renderer) their edits.
  blueprintDiverged?: boolean;
};
