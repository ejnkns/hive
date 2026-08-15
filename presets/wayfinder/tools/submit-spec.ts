// the wayfinder submit_spec recording tool (referenced by the

import { defineTool } from "workflow-engine/runners";
import type { BuildState } from "../build/types.ts";

export const submit_specTools = [
  defineTool<BuildState>({
    name: "submit_spec",
    description:
      "Record the drafted spec for the build phase. It becomes the input the planner reads; nothing is persisted until the human presses Done.",
    parameters: {
      properties: {
        spec: {
          type: "string",
          description:
            "The full spec in markdown: problem, solution, user stories, decisions, testing, out of scope, seams.",
        },
      },
      required: ["spec"],
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as { spec?: unknown };
      const patch: Partial<BuildState> = {};
      if (typeof args.spec === "string") {
        patch.spec = args.spec;
      }
      ctx.patchWorkflowInstanceState?.(patch);
      return {
        toolCallId: call.id,
        content: "Spec recorded",
        isError: false,
      };
    },
  }),
];
