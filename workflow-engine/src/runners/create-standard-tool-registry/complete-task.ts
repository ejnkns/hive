import type { ToolDefinition, ToolExecutor } from "../tool-types";

// The engine's generic completion tool: a flow's ai task can declare this as
// its completionTool (and list it in tools) without writing a domain tool.
// The parsed arguments become the task output, so gates branch on output
// fields (e.g. outcome === "already_satisfied") declaratively. Simple flows
// and AI-generated flows get a completion contract for free.
export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "complete_task",
    description:
      "Complete the current task with a declared outcome. This must be the only tool call in the response. The arguments become the task output.",
    parameters: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          description:
            "'implemented' when the task's work was done, 'already_satisfied' when the requested behavior was verified present with no changes needed, or 'blocked' when the task cannot be completed.",
        },
        summary: {
          type: "string",
          description: "Short summary of what was done or verified.",
        },
        rationale: {
          type: "string",
          description:
            "Required when outcome is 'already_satisfied' or 'blocked': the precise reason.",
        },
      },
      required: ["outcome"],
    },
  },
};

export const execute: ToolExecutor = async (call) => ({
  toolCallId: call.id,
  content: "Task completed",
  isError: false,
});
