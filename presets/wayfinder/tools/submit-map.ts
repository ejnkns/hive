// the wayfinder submit_map recording tool (referenced by the

import { defineTool } from "workflow-engine/runners";
import type { ChartingState } from "../charting/types.ts";

export const submit_mapTools = [
  defineTool<ChartingState>({
    name: "submit_map",
    description:
      "Record the settled charting destination and notes for this effort. Called once the human confirms the destination is sharp; a later task persists the map.",
    parameters: {
      properties: {
        destination: {
          type: "string",
          description: "The effort's settled destination, stated sharply.",
        },
        notes: {
          type: "string",
          description: "Standing notes on the effort, domain, or constraints.",
        },
      },
      required: ["destination"],
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as {
        destination?: unknown;
        notes?: unknown;
      };
      const patch: Partial<ChartingState> = {};
      if (typeof args.destination === "string") {
        patch.destination = args.destination;
      }
      if (typeof args.notes === "string") {
        patch.notes = args.notes;
      }
      ctx.patchWorkflowInstanceState?.(patch);
      return {
        toolCallId: call.id,
        content: "Map recorded",
        isError: false,
      };
    },
  }),
];
