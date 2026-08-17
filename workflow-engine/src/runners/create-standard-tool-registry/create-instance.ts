import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_instance",
    description:
      "Create a new workflow instance in this flow (e.g. graduate fog into a fresh decision ticket). The instance starts in the workflow's initial state (or the declared stateId when given); the supplied object becomes its domain state. Only available where the task declares this tool.",
    parameters: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "The id of the workflow to instantiate.",
        },
        instanceState: {
          type: "object",
          description: "Initial domain state for the new instance.",
        },
        stateId: {
          type: "string",
          description:
            "Optional: the workflow state to start the instance in (defaults to the workflow's initial state).",
        },
      },
      required: ["workflowId"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as {
    workflowId?: string;
    instanceState?: Record<string, unknown>;
    stateId?: string;
  };
  if (typeof args.workflowId !== "string" || args.workflowId === "") {
    return {
      toolCallId: call.id,
      content: "workflowId is required",
      isError: true,
    };
  }
  if (!ctx.createWorkflowInstance) {
    return {
      toolCallId: call.id,
      content: "create_instance is not available in this context",
      isError: true,
    };
  }
  try {
    const created = ctx.createWorkflowInstance(
      args.workflowId,
      args.instanceState ?? {},
      args.stateId
    );
    return {
      toolCallId: call.id,
      content: `Created ${args.workflowId} instance ${created.id}`,
      isError: false,
    };
  } catch (err: unknown) {
    return {
      toolCallId: call.id,
      content: err instanceof Error ? err.message : "Failed to create instance",
      isError: true,
    };
  }
};
