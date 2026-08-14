/** @private — the read_definition_source tool: reads the current definition
 * module (the single artifact, including any manual edits the user made
 * directly in the editor). Only flow-authoring/session/tools.ts imports this. */

import { defineTool } from "workflow-engine/runners";
import type { AuthoringItemState } from "../state.ts";

export const readDefinitionSourceTool = defineTool<AuthoringItemState>({
  name: "read_definition_source",
  description:
    "Read the current definition module TypeScript — the single artifact, including any manual edits the user made directly in the editor. Use this to reason about the exact current source before proposing changes or extending it.",
  parameters: {
    properties: {},
    required: [],
  },
  executor: async (call, ctx) => {
    const state = ctx.workflowInstanceState?.() ?? {};
    const source = typeof state.source === "string" ? state.source : "";
    return {
      toolCallId: call.id,
      content:
        source !== ""
          ? source
          : "No definition module yet — call set_flow_definition to write one.",
      isError: false,
    };
  },
});
