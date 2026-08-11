import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_diff",
    description:
      "Show the complete working tree or committed diff. When baseCommit is provided, shows diff between baseCommit and HEAD.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = ctx.baseCommit
    ? ["diff", "--no-ext-diff", `${ctx.baseCommit}...HEAD`]
    : ["diff", "--no-ext-diff"];
  const result = execFileSync("git", args, {
    cwd: ctx.workspacePath,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
  return {
    toolCallId: call.id,
    content: result || "(no diff)",
    isError: false,
  };
};
