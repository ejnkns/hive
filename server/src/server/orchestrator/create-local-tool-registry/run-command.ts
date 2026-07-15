import { execFile } from "node:child_process";
import type { Tool } from "../create-local-tool-registry";

type RunCommandArgs = {
  command: string;
  args?: string[];
};

function parseArgs(toolCall: { arguments: string }): RunCommandArgs {
  const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  if (typeof parsed.command !== "string") {
    throw new Error("missing required argument: command");
  }
  const args = Array.isArray(parsed.args)
    ? (parsed.args as unknown[]).map(String)
    : [];
  return { command: parsed.command, args };
}

function execAsync(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

export const runCommandTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Execute a shell command in the workspace directory. Returns stdout and stderr. Commands timeout after 30 seconds.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Arguments to pass to the command",
          },
        },
        required: ["command"],
      },
    },
  },
  execute: async (toolCall, context) => {
    try {
      const args = parseArgs(toolCall);
      const { stdout, stderr } = await execAsync(
        args.command,
        args.args ?? [],
        context.workspacePath
      );
      const parts: string[] = [];
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      return {
        toolCallId: toolCall.id,
        content: parts.join("\n") || "(no output)",
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { toolCallId: toolCall.id, content: message, isError: true };
    }
  },
};
