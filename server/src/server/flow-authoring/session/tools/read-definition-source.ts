/** @private — the read_definition_source tool: reads the current definition
 * entry (the working artifact, including manual edits). Only
 * flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import type { AuthoringItemState } from "../state.ts";

export const readDefinitionSourceTool = defineTool<AuthoringItemState>({
  name: "read_definition_source",
  description:
    "Read the current definition TypeScript — the working artifact, including any manual edits the user made directly in the editor. Use this to reason about the exact current source before proposing changes (especially while the blueprint is frozen by manual edits).",
  parameters: {
    properties: {},
    required: [],
  },
  executor: async (call, ctx) => {
    const state = ctx.workflowInstanceState?.() ?? {};
    // The gate-passed source, or — before/without a passing gate — the live
    // rendered entry (previewSource). A failed generate_definition must still
    // be readable: the agent fixes the blueprint by looking at the exact
    // typecheck line, not by guessing.
    const source =
      typeof state.source === "string" && state.source !== ""
        ? state.source
        : typeof state.previewSource === "string"
          ? state.previewSource
          : "";
    return {
      toolCallId: call.id,
      content:
        source !== ""
          ? source
          : "No definition source yet — the agent's last set_flow_blueprint or generate_definition output will appear here.",
      isError: false,
    };
  },
});
