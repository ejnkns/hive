/** @public — the flow-authoring session: a hidden built-in flow whose single
 * workflow instance is a live authoring conversation — the requirements-
 * drafting pattern (queen-bee) applied to flow authoring, where the artifact
 * is the definition module (a typed TS literal) instead of requirements.md.
 *
 * The session has ONE state: drafting. The ai-chat agent maintains the
 * definition module via `set_flow_definition` (validated live, rendered in the
 * editor), and the gate runs as the `validate_definition` TOOL — so a failed
 * gate returns its findings to the agent in the same conversation (nothing is
 * lost), the agent fixes and retries, and the session never ends on its own.
 *
 * Referenced files are co-edited through `read_definition_file` /
 * `write_definition_file`: the agent (or the user) implements the referenced
 * modules in-conversation, then validates — the gate runs against the current
 * files, whose hand edits are authoritative. The definition module is the
 * single artifact: the human's edits ARE the state (no divergence, no
 * adoption, no reverse renderer).
 *
 * Import from here, not from session/ directly. The implementation lives in
 * session/: the state vocabulary (state), the gate machinery
 * (generation-gate), the save core (save), the per-tool files (tools/), and
 * the workflow definition (workflow). */

export {
  readAuthoringModuleFile,
  seedAuthoringModuleFiles,
  writeAuthoringModuleFile,
} from "./session/files.ts";
export { saveAuthoringDefinition, savePatch } from "./session/save.ts";
export {
  AUTHORING_DEFINITION_ID,
  AUTHORING_MODULE_SET,
  type AuthoringItemState,
  authoringModuleSetDir,
} from "./session/state.ts";
export { authoringTools } from "./session/tools.ts";
export { authoringSessionFlow } from "./session/workflow.ts";
