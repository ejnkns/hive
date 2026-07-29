import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Execute one finite program in the worktree without a shell. Commands time out after 30 seconds. Do not launch graphical applications, development servers, or other interactive/long-running processes. Pass only the executable name in 'command' and every argument as a separate item in 'args'. Compound shell expressions, pipes, redirection, and direct Git mutations are not supported.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Executable name only, for example 'pnpm', 'git', or 'python3'.",
        },
        args: {
          type: "array",
          description: "Arguments to pass to the command.",
          items: { type: "string" },
        },
      },
      required: ["command"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as {
    command?: string;
    args?: string[];
  };
  if (!args.command) {
    return {
      toolCallId: call.id,
      content: "command is required",
      isError: true,
    };
  }

  try {
    const result = execFileSync(args.command, args.args ?? [], {
      cwd: ctx.workspacePath,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    return {
      toolCallId: call.id,
      content: result || "(no output)",
      isError: false,
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
      signal?: string;
    };
    const output =
      error.stdout?.toString().trim() || error.stderr?.toString().trim() || "";
    const message =
      error.status !== undefined
        ? `Command failed with exit code ${error.status}${output ? `:\n${output}` : ""}`
        : `Command terminated: ${error.signal || (err instanceof Error ? err.message : "Unknown error")}`;
    return { toolCallId: call.id, content: message, isError: true };
  }
};
