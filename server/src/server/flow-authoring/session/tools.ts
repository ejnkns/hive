/** @private — the authoring toolset: the session agent's tools, composed from
 * the per-tool files in tools/. Only flow-authoring/session.ts imports this. */

import { generateDefinitionTool } from "./tools/generate-definition.ts";
import { readAuthoringKnowledgeTool } from "./tools/read-authoring-knowledge.ts";
import { readDefinitionFileTool } from "./tools/read-definition-file.ts";
import { readDefinitionSourceTool } from "./tools/read-definition-source.ts";
import { saveDefinitionTool } from "./tools/save-definition.ts";
import { setFlowBlueprintTool } from "./tools/set-flow-blueprint.ts";
import { writeDefinitionFileTool } from "./tools/write-definition-file.ts";

export const authoringTools = [
  readAuthoringKnowledgeTool,
  setFlowBlueprintTool,
  generateDefinitionTool,
  saveDefinitionTool,
  readDefinitionSourceTool,
  readDefinitionFileTool,
  writeDefinitionFileTool,
];
