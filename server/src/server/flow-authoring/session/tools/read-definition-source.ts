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
    const source = ctx.workflowInstanceState?.()?.source;
    return {
      toolCallId: call.id,
      content:
        typeof source === "string" && source !== ""
          ? source
          : "No definition source yet — the agent's last generate_definition output, or a manual edit, will appear here.",
      isError: false,
    };
  },
});
