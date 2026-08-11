import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_log",
    description:
      "Show commits on the current branch. When baseCommit is provided, shows commits since that base.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = ctx.baseCommit
    ? ["log", "--oneline", "--decorate", `${ctx.baseCommit}..HEAD`]
    : ["log", "--oneline", "--decorate", "-20"];
  const result = execFileSync("git", args, {
    cwd: ctx.workspacePath,
    encoding: "utf-8",
    timeout: 5_000,
  }).trim();
  return {
    toolCallId: call.id,
    content: result || "(no commits)",
    isError: false,
  };
};
