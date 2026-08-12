/** @private — the write_definition_file tool: creates or edits a referenced
 * file of the current module set, constrained to the definition root. Hand
 * edits are authoritative — no divergence machinery applies to files. Only
 * flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import { writeAuthoringModuleFile } from "../files.ts";
import type { AuthoringItemState } from "../state.ts";
import { toolError } from "./shared.ts";

export const writeDefinitionFileTool = defineTool<AuthoringItemState>({
  name: "write_definition_file",
  description:
    "Create or edit a referenced file of the current module set (a gate, tool, operation, edge transform, or extractor). Hand edits are authoritative — the next generate_definition runs the gate against exactly this content, and it is never overwritten by stub emission. Paths are relative to the definition root, e.g. ./gates/approved.ts.",
  parameters: {
    properties: {
      path: {
        type: "string",
        description:
          "Relative path inside the definition root, e.g. ./gates/approved.ts",
      },
      content: {
        type: "string",
        description:
          "The full file source. Keep the export name the entry imports (the stub declares it) and the contract the engine declares.",
      },
    },
    required: ["path", "content"],
  },
  executor: async (call, ctx) => {
    const args = JSON.parse(call.arguments) as {
      path?: string;
      content?: string;
    };
    const result = writeAuthoringModuleFile(
      ctx.workflowInstanceState?.() ?? {},
      typeof args.path === "string" ? args.path.trim() : "",
      typeof args.content === "string" ? args.content : ""
    );
    if (!result.ok) return toolError(call, result.message);
    // The file is the truth — record it on the session so a save persists it,
    // and the next generate reads it back from disk.
    ctx.patchWorkflowInstanceState?.({ files: result.files });
    return {
      toolCallId: call.id,
      content: `Wrote ${args.path} (${(args.content ?? "").length} chars). Call generate_definition to run the gate against it.`,
      isError: false,
    };
  },
});
