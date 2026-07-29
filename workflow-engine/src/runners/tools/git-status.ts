import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_status",
    description: "Show the current git working-tree status.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const result = execFileSync("git", ["status", "--short"], {
    cwd: ctx.workspacePath,
    encoding: "utf-8",
    timeout: 5_000,
  }).trim();
  return {
    toolCallId: call.id,
    content: result || "Working tree clean",
    isError: false,
  };
};
