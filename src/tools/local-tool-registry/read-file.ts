import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../tool";

type ReadFileArgs = {
  path: string;
};

function parseArgs(toolCall: { arguments: string }): ReadFileArgs {
  const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  if (typeof parsed.path !== "string") {
    throw new Error("missing required argument: path");
  }
  return { path: parsed.path };
}

function resolvePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath)) {
    throw new Error("path escapes workspace directory");
  }
  return resolved;
}

export const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. The path is relative to the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to workspace root",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (toolCall, context) => {
    try {
      const args = parseArgs(toolCall);
      const resolved = resolvePath(context.workspacePath, args.path);
      const content = await fs.readFile(resolved, "utf-8");
      return { toolCallId: toolCall.id, content, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { toolCallId: toolCall.id, content: message, isError: true };
    }
  },
};
