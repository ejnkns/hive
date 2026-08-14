/** @private — the validate_definition tool: runs the full definition gate on
 * the session's current definition module + referenced files — definition
 * validation, the module-set lint, import policy, typecheck, declared-writes
 * verification, and the load (import → validate → compile) — returning the
 * findings to the conversation. Replaces the old generate_definition: there
 * is no render step (the module IS the artifact); the gate proves it
 * validates, compiles, and runs. Only flow-authoring/session/tools.ts imports
 * this. */

import { defineTool } from "workflow-engine/runners";
import {
  type DefinitionPreview,
  runDefinitionGate,
  validateAndPreview,
} from "../generation-gate.ts";
import { AUTHORING_MODULE_SET, type AuthoringItemState } from "../state.ts";
import { toolError } from "./shared.ts";

export const validateDefinitionTool = defineTool<AuthoringItemState>({
  name: "validate_definition",
  description:
    "Run the full definition gate on the current definition module and its referenced files: definition validation, the per-reference lint, the import policy, the whole-set typecheck, the declared-writes verification, and the load (the definition compiles to the runtime projection and registers). Fix any findings with set_flow_definition / write_definition_file and call this again. The conversation continues after a successful validation.",
  parameters: {
    properties: {},
    required: [],
  },
  executor: async (call, ctx) => {
    const state = ctx.workflowInstanceState?.() ?? {};
    const source = typeof state.source === "string" ? state.source : "";
    if (source.trim() === "") {
      return toolError(
        call,
        "No definition module yet — call set_flow_definition first."
      );
    }

    let preview: DefinitionPreview;
    try {
      preview = validateAndPreview(source);
    } catch (err) {
      return toolError(
        call,
        `the definition module is not valid TypeScript: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (preview.previewErrors.length > 0) {
      ctx.patchWorkflowInstanceState?.({
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
        content: `The definition failed validation. Fix these findings, then call validate_definition again:\n${preview.previewErrors
          .slice(0, 12)
          .map((e) => `- ${e}`)
          .join("\n")}`,
        isError: false,
      };
    }

    const result = await runDefinitionGate(
      preview.parsed,
      source,
      state.moduleSetSlug ?? AUTHORING_MODULE_SET,
      state.files ?? {}
    );
    if (result.errors.length > 0) {
      ctx.patchWorkflowInstanceState?.({
        previewErrors: [],
        gateErrors: result.errors,
        files: result.files,
        report: {
          passed: false,
          attempts: 1,
          errors: result.errors,
          warnings: result.warnings,
        },
      });
      return {
        toolCallId: call.id,
        content: `The definition failed the gate. Fix these findings, then call validate_definition again:\n${result.errors
          .slice(0, 12)
          .map((e) => `- ${e}`)
          .join("\n")}`,
        isError: false,
      };
    }

    ctx.patchWorkflowInstanceState?.({
      previewErrors: [],
      source,
      files: result.files,
      gateErrors: [],
      report: {
        passed: true,
        attempts: 1,
        errors: [],
        warnings: result.warnings,
      },
      suggestedName: preview.parsed.label,
    });
    return {
      toolCallId: call.id,
      content:
        "Definition validated and compiled successfully — it is registered in the session and ready to save. Summarize the definition for the user.",
      isError: false,
    };
  },
});
