/** @private — the save_definition tool: registers the current generated
 * definition as a flow definition (create on first save, update afterwards).
 * Only flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import { saveAuthoringDefinition, savePatch } from "../save.ts";
import type { AuthoringItemState } from "../state.ts";

export const saveDefinitionTool = defineTool<AuthoringItemState>({
  name: "save_definition",
  description:
    "Register the current generated definition (the source in the editor) as a flow definition. Call this when the user asks to save or says it is ready — the definition registers immediately and the editor shows the saved state. The first save creates the definition (named from the blueprint's label, or the explicit name); later saves update the same definition.",
  parameters: {
    properties: {
      name: {
        type: "string",
        description:
          "Optional name override. Defaults to the blueprint's label (suggestedName).",
      },
    },
    required: [],
  },
  executor: async (call, ctx) => {
    const args = JSON.parse(call.arguments) as { name?: string };
    try {
      const result = await saveAuthoringDefinition(
        ctx.workflowInstanceState?.() ?? {},
        typeof args.name === "string" ? args.name : undefined
      );
      ctx.patchWorkflowInstanceState?.(savePatch(result));
      const findings =
        result.checkErrors.length > 0 || result.checkWarnings.length > 0
          ? `\nFindings: ${result.checkErrors.length} error(s), ${result.checkWarnings.length} warning(s).`
          : "";
      return {
        toolCallId: call.id,
        content: `Definition saved as "${result.name}" (${result.id}).${findings}`,
        isError: false,
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
});
