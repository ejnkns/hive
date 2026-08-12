/** @private — the generate_definition tool: runs the generation gate on the
 * current blueprint draft, returning the findings to the conversation. Only
 * flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import {
  type BlueprintPreview,
  runGenerationGate,
  validateAndPreview,
} from "../generation-gate.ts";
import { AUTHORING_MODULE_SET, type AuthoringItemState } from "../state.ts";
import { divergedResult, isDiverged } from "./shared.ts";

export const generateDefinitionTool = defineTool<AuthoringItemState>({
  name: "generate_definition",
  description:
    "Run the generation gate on the current blueprint draft and produce the TypeScript definition in the editor. Pass the same blueprint JSON you last passed to set_flow_blueprint. Returns the gate findings — if there are errors, fix the blueprint with set_flow_blueprint and call this again. The conversation continues after a successful generation.",
  parameters: {
    properties: {
      blueprint: {
        type: "string",
        description: "The complete FlowBlueprint JSON to generate.",
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

    if (preview.previewErrors.length > 0) {
      ctx.patchWorkflowInstanceState?.({
        blueprint: args.blueprint,
        previewSource: preview.previewSource,
        previewErrors: preview.previewErrors,
        gateErrors: preview.previewErrors,
        report: {
          passed: false,
          attempts: 1,
          errors: preview.previewErrors,
          warnings: [],
        },
      });
      return {
        toolCallId: call.id,
        content: `The definition failed validation. Fix these findings, then call generate_definition again:\n${preview.previewErrors
          .slice(0, 12)
          .map((e) => `- ${e}`)
          .join("\n")}`,
        isError: false,
      };
    }

    const { source, files, errors, warnings } = await runGenerationGate(
      preview.parsed,
      ctx.workflowInstanceState?.()?.moduleSetSlug ?? AUTHORING_MODULE_SET
    );
    if (errors.length > 0) {
      ctx.patchWorkflowInstanceState?.({
        blueprint: args.blueprint,
        previewSource: preview.previewSource,
        previewErrors: [],
        gateErrors: errors,
        files,
        report: { passed: false, attempts: 1, errors, warnings },
        suggestedName: preview.parsed.label,
      });
      return {
        toolCallId: call.id,
        content: `The definition failed the gate. Fix these findings, then call generate_definition again:\n${errors
          .slice(0, 12)
          .map((e) => `- ${e}`)
          .join("\n")}`,
        isError: false,
      };
    }

    ctx.patchWorkflowInstanceState?.({
      blueprint: args.blueprint,
      previewSource: source,
      previewErrors: [],
      source,
      files,
      gateErrors: [],
      report: { passed: true, attempts: 1, errors: [], warnings },
      suggestedName: preview.parsed.label,
    });
    return {
      toolCallId: call.id,
      content:
        "Definition generated successfully — the TypeScript source is now in the editor. Summarize the definition for the user.",
      isError: false,
    };
  },
});
