import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
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
          description: "File path relative to workspace root.",
        },
        content: {
          type: "string",
          description: "Content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as {
    path?: string;
    content?: string;
  };
  if (!args.path) {
    return { toolCallId: call.id, content: "path is required", isError: true };
  }
  if (typeof args.content !== "string") {
    return {
      toolCallId: call.id,
      content: "content is required",
      isError: true,
    };
  }

  const resolved = resolve(ctx.workspacePath, args.path);
  if (!resolved.startsWith(ctx.workspacePath)) {
    return {
      toolCallId: call.id,
      content: "Path escapes workspace directory",
      isError: true,
    };
  }

  mkdirSync(join(resolved, ".."), { recursive: true });
  writeFileSync(resolved, args.content, "utf-8");

  return {
    toolCallId: call.id,
    content: `Wrote ${args.content.length} bytes to ${args.path}`,
    isError: false,
  };
};
