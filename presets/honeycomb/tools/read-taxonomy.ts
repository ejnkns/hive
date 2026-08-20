// The honeycomb read_taxonomy tool (referenced by the flow definition).

import { defineTool } from "workflow-engine/runners";

// E2 tool read: the import parse agent and the per-idea classifier fetch the
// published taxonomy from flowState — the shared cross-entity state — instead
// of a hardcoded list.
export const read_taxonomyTools = [
  defineTool({
    name: "read_taxonomy",
    description:
      "Read the flow's published taxonomy (categories with definitions, and categoryNames) from flowState.",
    parameters: { properties: {}, required: [] },
    executor: async (call, ctx) => ({
      toolCallId: call.id,
      content: JSON.stringify(ctx.flowState?.() ?? {}),
      isError: false,
    }),
  }),
];
