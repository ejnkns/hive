/** @private — the set_flow_definition tool: replaces the session's definition
 * module source and validates it (the parsed definition's declared parts are
 * decidable). The source IS the artifact — the editor's Definition tab shows
 * it and the human edits it directly; there is no second artifact to diverge
 * from. Only flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import {
  type DefinitionPreview,
  validateAndPreview,
} from "../generation-gate.ts";
import type { AuthoringItemState } from "../state.ts";
import { toolError } from "./shared.ts";

export const setFlowDefinitionTool = defineTool<AuthoringItemState>({
  name: "set_flow_definition",
  description:
    "Replace the flow's definition module with the complete TypeScript source — the single pure-data artifact (`export const flow: FlowDefinition = { ... }`, workflows/states/tasks as data, custom logic referenced by ref path). Call this after every substantive decision with the full module; the draft renders live in the editor. The result reports validation findings to fix. Referenced files are implemented separately with write_definition_file.",
  parameters: {
    properties: {
      source: {
        type: "string",
        description: "The complete definition module TypeScript source.",
      },
    },
    required: ["source"],
  },
  executor: async (call, ctx) => {
    const args = JSON.parse(call.arguments) as { source?: string };
    if (typeof args.source !== "string" || args.source.trim() === "") {
      return toolError(call, "source is required");
    }

    let preview: DefinitionPreview;
    try {
      preview = validateAndPreview(args.source);
    } catch (err) {
      return toolError(
        call,
        `the definition module is not valid TypeScript: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    ctx.patchWorkflowInstanceState?.({
      source: args.source,
      previewErrors: preview.previewErrors,
      // The editor's Definition tab binds to the parsed definition object.
      parsedDefinition: preview.parsed,
      gateErrors: [],
      suggestedName: preview.parsed.label,
    });

    return {
      toolCallId: call.id,
      content:
        preview.previewErrors.length > 0
          ? `Definition module stored, but it has ${preview.previewErrors.length} finding(s):\n${preview.previewErrors
              .slice(0, 12)
              .join("\n")}`
          : "Definition module stored and validates cleanly.",
      isError: false,
    };
  },
});
