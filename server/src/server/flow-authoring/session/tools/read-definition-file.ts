/** @private — the read_definition_file tool: reads a referenced file of the
 * current module set, constrained to the definition root. Only
 * flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import { readAuthoringModuleFile } from "../files.ts";
import type { AuthoringItemState } from "../state.ts";
import { toolError } from "./shared.ts";

export const readDefinitionFileTool = defineTool<AuthoringItemState>({
  name: "read_definition_file",
  description:
    "Read a referenced file of the current module set (a gate, tool, operation, edge transform, or extractor). Paths are relative to the definition root, e.g. ./gates/approved.ts. Use this to see the stub or the current implementation before editing.",
  parameters: {
    properties: {
      path: {
        type: "string",
        description:
          "Relative path inside the definition root, e.g. ./gates/approved.ts",
      },
    },
    required: ["path"],
  },
  executor: async (call, ctx) => {
    const args = JSON.parse(call.arguments) as { path?: string };
    const result = readAuthoringModuleFile(
      ctx.workflowInstanceState?.() ?? {},
      typeof args.path === "string" ? args.path.trim() : ""
    );
    if (!result.ok) return toolError(call, result.message);
    return {
      toolCallId: call.id,
      content: result.content,
      isError: false,
    };
  },
});
