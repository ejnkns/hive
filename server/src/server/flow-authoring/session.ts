/** @public — the flow-authoring session: a hidden built-in flow whose single
 * workflow instance is a live authoring conversation — the requirements-
 * drafting pattern (queen-bee) applied to flow authoring, where the artifact
 * is a FlowBlueprint/TypeScript definition instead of requirements.md.
 *
 * The session has ONE state: drafting. The ai-chat agent maintains the blueprint
 * draft via `set_flow_blueprint` (rendered live as TypeScript in the editor), and
 * the generation gate runs as the `generate_definition` TOOL — so a failed
 * gate returns its findings to the agent in the same conversation (nothing is
 * lost), the agent fixes and retries, and the session never ends on its own.
 *
 * Referenced files are co-edited through `read_definition_file` /
 * `write_definition_file`: the agent (or the user) implements the generated
 * stubs in-conversation, then regenerates — the gate runs against the current
 * files, whose hand edits are authoritative (no divergence machinery for
 * files; the file IS the truth).
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
export { saveAuthoringBlueprint } from "./session/generation-gate.ts";
export { saveAuthoringDefinition, savePatch } from "./session/save.ts";
export {
  AUTHORING_DEFINITION_ID,
  AUTHORING_MODULE_SET,
  type AuthoringItemState,
  authoringModuleSetDir,
} from "./session/state.ts";
export { authoringTools } from "./session/tools.ts";
export { authoringSessionFlow } from "./session/workflow.ts";
