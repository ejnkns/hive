// The honeycomb read_taxonomy tool (referenced by the flow definition).

import { defineTool } from "workflow-engine/runners";

// E2 tool read: the per-idea classifier fetches the approved taxonomy from
// flowState — the shared cross-entity state — instead of a hardcoded list.
export const read_taxonomyTools = [
  defineTool({
    name: "read_taxonomy",
    description:
      "Read the flow's approved taxonomy (categories with definitions, priorityScale, effortScale, dedupPolicy) from flowState.",
    parameters: { properties: {}, required: [] },
    executor: async (call, ctx) => ({
      toolCallId: call.id,
      content: JSON.stringify(ctx.flowState?.() ?? {}),
      isError: false,
    }),
  }),
];
