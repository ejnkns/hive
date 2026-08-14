/** @private — the authoring toolset: the session agent's tools, composed from
 * the per-tool files in tools/. Only flow-authoring/session.ts imports this.
 *
 * The definition is the single pure-data artifact: the agent writes the
 * definition module (set_flow_definition), implements the referenced files
 * in-conversation (read/write_definition_file), proves the whole set through
 * the gate (validate_definition), and registers it (save_definition). Hand
 * edits to the module and the files are the state — there is no second
 * artifact to diverge from. */

import { readAuthoringKnowledgeTool } from "./tools/read-authoring-knowledge.ts";
import { readDefinitionFileTool } from "./tools/read-definition-file.ts";
import { readDefinitionSourceTool } from "./tools/read-definition-source.ts";
import { saveDefinitionTool } from "./tools/save-definition.ts";
import { setFlowDefinitionTool } from "./tools/set-flow-definition.ts";
import { validateDefinitionTool } from "./tools/validate-definition.ts";
import { writeDefinitionFileTool } from "./tools/write-definition-file.ts";

export const authoringTools = [
  readAuthoringKnowledgeTool,
  setFlowDefinitionTool,
  validateDefinitionTool,
  saveDefinitionTool,
  readDefinitionSourceTool,
  readDefinitionFileTool,
  writeDefinitionFileTool,
];
