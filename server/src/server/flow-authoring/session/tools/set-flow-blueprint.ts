/** @private — the set_flow_blueprint tool: replaces the blueprint draft and
 * renders the live preview. Only flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import {
  type BlueprintPreview,
  validateAndPreview,
} from "../generation-gate.ts";
import type { AuthoringItemState } from "../state.ts";
import { divergedResult, isDiverged } from "./shared.ts";

export const setFlowBlueprintTool = defineTool<AuthoringItemState>({
  name: "set_flow_blueprint",
  description:
    "Replace the flow's blueprint draft with the complete FlowBlueprint JSON. Call this after every substantive decision with the full blueprint; the draft renders live in the editor. The result reports validation errors to fix.",
  parameters: {
    properties: {
      blueprint: {
        type: "string",
        description: "The complete FlowBlueprint as a JSON string.",
      },
    },
    required: ["blueprint"],
  },
  executor: async (call, ctx) => {
    if (isDiverged(ctx)) return divergedResult(call);
    const args = JSON.parse(call.arguments) as { blueprint?: string };
    if (typeof args.blueprint !== "string" || args.blueprint.trim() === "") {
      return {
        toolCallId: call.id,
        content: "blueprint is required",
        isError: true,
      };
    }

    let preview: BlueprintPreview;
    try {
      preview = validateAndPreview(args.blueprint);
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `blueprint is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
        isError: true,
      };
    }

    ctx.patchWorkflowInstanceState?.({
      blueprint: args.blueprint,
      previewSource: preview.previewSource,
      previewErrors: preview.previewErrors,
    });

    return {
      toolCallId: call.id,
      content:
        preview.previewErrors.length > 0
          ? `Spec draft stored, but it has ${preview.previewErrors.length} finding(s):\n${preview.previewErrors
              .slice(0, 10)
              .join("\n")}`
          : "Spec draft stored and renders cleanly.",
      isError: false,
    };
  },
});
