/** @private — the read_definition_file tool: reads a referenced file of the
 * current module set, constrained to the definition root. Only
 * flow-authoring/session/tools.ts imports this. */

import { existsSync, readFileSync } from "node:fs";
import { defineTool } from "workflow-engine/runners";
import { refPathInDir } from "../../../flow-definitions.ts";
import { type AuthoringItemState, authoringModuleSetDir } from "../state.ts";
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
  executor: async (call) => {
    const args = JSON.parse(call.arguments) as { path?: string };
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (path === "" || path === "flow.ts") {
      return toolError(
        call,
        "path is required and must name a referenced file (flow.ts is the rendered entry — edit the blueprint instead)"
      );
    }
    const target = refPathInDir(authoringModuleSetDir(), path);
    if (target === undefined) {
      return toolError(
        call,
        `path must stay inside the definition root (got "${path}")`
      );
    }
    if (!existsSync(target)) {
      return toolError(
        call,
        `no file at "${path}" — generate the definition first (the gate emits a stub for every referenced file)`
      );
    }
    return {
      toolCallId: call.id,
      content: readFileSync(target, "utf-8"),
      isError: false,
    };
  },
});
