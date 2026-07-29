import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "commit_work",
    description:
      "Create a meaningful implementation commit. Declare exactly which relative worktree paths belong in the commit. Repository Git hooks run normally.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "Commit subject following the repository's documented conventions.",
        },
        paths: {
          type: "array",
          description: "Relative files or directories to stage and commit.",
          items: { type: "string" },
        },
      },
      required: ["message", "paths"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as {
    message?: string;
    paths?: string[];
  };
  if (!args.message || !args.paths?.length) {
    return {
      toolCallId: call.id,
      content: "message and paths are required",
      isError: true,
    };
  }

  try {
    execFileSync("git", ["add", "--", ...args.paths], {
      cwd: ctx.workspacePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    execFileSync("git", ["commit", "-m", args.message], {
      cwd: ctx.workspacePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return {
      toolCallId: call.id,
      content: `Committed: ${args.message}`,
      isError: false,
    };
  } catch (err: unknown) {
    return {
      toolCallId: call.id,
      content: err instanceof Error ? err.message : "Commit failed",
      isError: true,
    };
  }
};
