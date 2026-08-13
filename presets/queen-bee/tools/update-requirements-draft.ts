// The queen-bee update_requirements_draft recording tool, referenced by the
// queen-bee blueprint.

import { defineTool } from "workflow-engine/runners";
import type { RequirementsState } from "../requirements/types.ts";

export const update_requirements_draftTools = [
  defineTool<RequirementsState>({
    name: "update_requirements_draft",
    description:
      "Replace the session's proposed requirements draft. This never mutates the canonical requirements document.",
    parameters: {
      properties: {
        content: {
          type: "string",
          description: "The full requirements document in markdown format.",
        },
      },
      required: ["content"],
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as { content?: string };
      if (typeof args.content !== "string") {
        return {
          toolCallId: call.id,
          content: "content is required",
          isError: true,
        };
      }
      ctx.patchWorkflowInstanceState?.({
        requirementsDraft: args.content,
      });
      return {
        toolCallId: call.id,
        content: "Requirements draft updated",
        isError: false,
      };
    },
  }),
];
