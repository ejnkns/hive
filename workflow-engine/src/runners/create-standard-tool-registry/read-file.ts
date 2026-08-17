/** @private — only imported by create-standard-tool-registry.ts */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { resolveReadPath } from "../resolve-read-path.ts";
import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a file relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace root.",
        },
      },
      required: ["path"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as { path?: string };
  if (!args.path) {
    return { toolCallId: call.id, content: "path is required", isError: true };
  }

  if (ctx.projectRevision) {
    const normPath = normalizePath(args.path);
    const content = execFileSync(
      "git",
      ["show", `${ctx.projectRevision}:${normPath}`],
      {
        cwd: ctx.workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      }
    ).trim();
    if (Buffer.byteLength(content, "utf-8") > 100_000) {
      return {
        toolCallId: call.id,
        content: "File is larger than 100000 bytes",
        isError: true,
      };
    }
    return { toolCallId: call.id, content, isError: false };
  }

  const filePath = resolveReadPath(
    args.path,
    ctx.workspacePath,
    ctx.extraReadRoots
  );
  if (filePath === undefined) {
    return {
      toolCallId: call.id,
      content: "Path escapes the workspace and every granted read root",
      isError: true,
    };
  }

  const st = statSync(filePath);
  if (st.isDirectory()) {
    return {
      toolCallId: call.id,
      content: "Path is a directory, not a file",
      isError: true,
    };
  }

  const maxBytes = 100_000;
  if (st.size > maxBytes) {
    return {
      toolCallId: call.id,
      content: `File is ${st.size} bytes (max ${maxBytes})`,
      isError: true,
    };
  }

  return {
    toolCallId: call.id,
    content: readFileSync(filePath, "utf-8"),
    isError: false,
  };
};

function normalizePath(path: string): string {
  const normalized = path.replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Path escapes workspace directory");
  }
  return normalized;
}
