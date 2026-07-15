import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../tool";

type WriteFileArgs = {
  path: string;
  content: string;
};

function parseArgs(toolCall: { arguments: string }): WriteFileArgs {
  const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  if (typeof parsed.path !== "string") {
    throw new Error("missing required argument: path");
  }
  if (typeof parsed.content !== "string") {
    throw new Error("missing required argument: content");
  }
  return { path: parsed.path, content: parsed.content };
}

function resolvePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath)) {
    throw new Error("path escapes workspace directory");
  }
  return resolved;
}

export const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file, creating parent directories as needed. The path is relative to the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to workspace root",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: async (toolCall, context) => {
    try {
      const args = parseArgs(toolCall);
      const resolved = resolvePath(context.workspacePath, args.path);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, args.content, "utf-8");
      return {
        toolCallId: toolCall.id,
        content: `wrote ${String(args.content.length)} bytes to ${args.path}`,
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { toolCallId: toolCall.id, content: message, isError: true };
    }
  },
};
