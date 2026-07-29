import { execFileSync } from "node:child_process";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_code",
    description:
      "Search for a pattern in the codebase using ripgrep. Returns matching file paths and line content.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex or literal pattern to search for.",
        },
      },
      required: ["pattern"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as { pattern?: string };
  if (!args.pattern) {
    return {
      toolCallId: call.id,
      content: "pattern is required",
      isError: true,
    };
  }

  try {
    if (ctx.projectRevision) {
      const result = execFileSync(
        "git",
        ["grep", "-n", "-e", args.pattern, ctx.projectRevision, "--"],
        {
          cwd: ctx.workspacePath,
          encoding: "utf-8",
          timeout: 10_000,
        }
      );
      const lines = result.split("\n").filter(Boolean);
      return {
        toolCallId: call.id,
        content:
          lines.slice(0, 100).join("\n") +
          (lines.length > 100
            ? `\n... (${lines.length - 100} more matches)`
            : ""),
        isError: false,
      };
    }

    const result = execFileSync(
      "rg",
      ["-n", "--no-heading", "-e", args.pattern, "."],
      {
        cwd: ctx.workspacePath,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      }
    );
    const lines = result.split("\n").filter(Boolean);
    const truncated = lines.slice(0, 100).join("\n");
    const suffix =
      lines.length > 100 ? `\n... (${lines.length - 100} more matches)` : "";
    return {
      toolCallId: call.id,
      content: truncated + suffix || "No matches found",
      isError: false,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    if (stderr.includes("No such file") || status === 1) {
      return {
        toolCallId: call.id,
        content: "No matches found",
        isError: false,
      };
    }
    return {
      toolCallId: call.id,
      content: err instanceof Error ? err.message : "Search failed",
      isError: true,
    };
  }
};
