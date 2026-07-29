import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_show",
    description: "Read a committed file at a specific revision.",
    parameters: {
      type: "object",
      properties: {
        revision: {
          type: "string",
          description: "Commit SHA or HEAD.",
        },
        path: {
          type: "string",
          description: "Relative file path to read at the revision.",
        },
      },
      required: ["revision", "path"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as {
    revision?: string;
    path?: string;
  };
  if (!args.revision || !args.path) {
    return {
      toolCallId: call.id,
      content: "revision and relative path are required",
      isError: true,
    };
  }
  if (args.revision.startsWith("-") || args.path.startsWith("-")) {
    return { toolCallId: call.id, content: "Invalid arguments", isError: true };
  }

  const result = execFileSync(
    "git",
    ["show", `${args.revision}:${args.path}`],
    {
      cwd: ctx.workspacePath,
      encoding: "utf-8",
      timeout: 10_000,
    }
  ).trim();
  return { toolCallId: call.id, content: result, isError: false };
};
