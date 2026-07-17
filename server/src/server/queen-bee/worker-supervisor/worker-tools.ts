/** @private — only imported by worker-supervisor.ts */

import { execFile, execSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../devise-engine/devise-tools";
import { DEVISE_TOOLS } from "../devise-engine/devise-tools";

export const WORKER_TOOLS: ToolDefinition[] = [
  ...DEVISE_TOOLS,
  {
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
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Execute a shell command in the workspace directory. Returns stdout and stderr. Commands timeout after 30 seconds. Pass arguments as a single string in 'args'.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute",
          },
          args: {
            type: "string",
            description: "Space-separated arguments to pass to the command",
          },
        },
        required: ["command"],
      },
    },
  },
];

export function executeWorkerTool(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  try {
    switch (toolCall.name) {
      case "write_file":
        return writeFile(toolCall, workspacePath);
      case "run_command":
        return runCommand(toolCall, workspacePath);
      default:
        return executeDeviseToolFallback(toolCall, workspacePath);
    }
  } catch (err) {
    return {
      toolCallId: toolCall.id,
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

function writeFile(toolCall: ToolCall, workspacePath: string): ToolResult {
  const args = JSON.parse(toolCall.arguments) as {
    path?: string;
    content?: string;
  };
  if (!args.path) {
    return {
      toolCallId: toolCall.id,
      content: "path is required",
      isError: true,
    };
  }
  if (typeof args.content !== "string") {
    return {
      toolCallId: toolCall.id,
      content: "content is required",
      isError: true,
    };
  }

  const resolved = resolve(workspacePath, args.path);
  if (!resolved.startsWith(workspacePath)) {
    return {
      toolCallId: toolCall.id,
      content: "Path escapes workspace directory",
      isError: true,
    };
  }

  mkdirSync(join(resolved, ".."), { recursive: true });
  writeFileSync(resolved, args.content, "utf-8");

  return {
    toolCallId: toolCall.id,
    content: `Wrote ${String(args.content.length)} bytes to ${args.path}`,
    isError: false,
  };
}

function runCommand(toolCall: ToolCall, workspacePath: string): ToolResult {
  const args = JSON.parse(toolCall.arguments) as {
    command?: string;
    args?: string[];
  };
  if (!args.command) {
    return {
      toolCallId: toolCall.id,
      content: "command is required",
      isError: true,
    };
  }

  const cmdArgs = Array.isArray(args.args) ? args.args : [];

  return new Promise<ToolResult>((resolveResult) => {
    execFile(
      args.command!,
      cmdArgs,
      { cwd: workspacePath, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolveResult({
            toolCallId: toolCall.id,
            content: error.message,
            isError: true,
          });
          return;
        }

        const parts: string[] = [];
        if (stdout) parts.push(`stdout:\n${stdout}`);
        if (stderr) parts.push(`stderr:\n${stderr}`);

        resolveResult({
          toolCallId: toolCall.id,
          content: parts.join("\n") || "(no output)",
          isError: false,
        });
      }
    );
  }) as unknown as ToolResult;
}

function executeDeviseToolFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  switch (toolCall.name) {
    case "update_requirements":
      return updateRequirementsFallback(toolCall, workspacePath);
    case "list_directory":
      return listDirectoryFallback(toolCall, workspacePath);
    case "read_file":
      return readFileFallback(toolCall, workspacePath);
    case "search_code":
      return searchCodeFallback(toolCall, workspacePath);
    default:
      return {
        toolCallId: toolCall.id,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
  }
}

function updateRequirementsFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const args = JSON.parse(toolCall.arguments) as { content?: string };
  if (!args.content) {
    return {
      toolCallId: toolCall.id,
      content: "content is required",
      isError: true,
    };
  }

  const hiveDir = join(workspacePath, ".hive");
  mkdirSync(hiveDir, { recursive: true });
  writeFileSync(join(hiveDir, "requirements.md"), args.content, "utf-8");

  return {
    toolCallId: toolCall.id,
    content: "Requirements document updated",
    isError: false,
  };
}

function listDirectoryFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const args = JSON.parse(toolCall.arguments) as { path?: string };
  const dirPath = resolve(workspacePath, args.path ?? ".");

  if (!dirPath.startsWith(workspacePath)) {
    return {
      toolCallId: toolCall.id,
      content: "Path escapes workspace directory",
      isError: true,
    };
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const listing = entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".hive")
    .map((e) => {
      const rel = relative(workspacePath, join(dirPath, e.name));
      return e.isDirectory() ? `${rel}/` : rel;
    })
    .sort()
    .join("\n");

  return {
    toolCallId: toolCall.id,
    content: listing || "(empty)",
    isError: false,
  };
}

function readFileFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const args = JSON.parse(toolCall.arguments) as { path?: string };
  if (!args.path) {
    return {
      toolCallId: toolCall.id,
      content: "path is required",
      isError: true,
    };
  }

  const filePath = resolve(workspacePath, args.path);
  if (!filePath.startsWith(workspacePath)) {
    return {
      toolCallId: toolCall.id,
      content: "Path escapes workspace directory",
      isError: true,
    };
  }

  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    return {
      toolCallId: toolCall.id,
      content: "Path is a directory, not a file",
      isError: true,
    };
  }

  const maxBytes = 100_000;
  if (stat.size > maxBytes) {
    return {
      toolCallId: toolCall.id,
      content: `File is ${stat.size} bytes (max ${maxBytes}). Use read_file with a range or limit.`,
      isError: true,
    };
  }

  const content = readFileSync(filePath, "utf-8");
  return { toolCallId: toolCall.id, content, isError: false };
}

function searchCodeFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const args = JSON.parse(toolCall.arguments) as { pattern?: string };
  if (!args.pattern) {
    return {
      toolCallId: toolCall.id,
      content: "pattern is required",
      isError: true,
    };
  }

  try {
    const escaped = args.pattern.replace(/"/g, '\\"');
    const result = execSync(`rg -n --no-heading -e "${escaped}" .`, {
      cwd: workspacePath,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });

    const lines = result.split("\n").filter(Boolean);
    const truncated = lines.slice(0, 100).join("\n");
    const suffix =
      lines.length > 100
        ? `\n... (${String(lines.length - 100)} more matches)`
        : "";

    return {
      toolCallId: toolCall.id,
      content: truncated + suffix || "No matches found",
      isError: false,
    };
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    if (
      stderr.includes("No such file") ||
      (err as { status?: number })?.status === 1
    ) {
      return {
        toolCallId: toolCall.id,
        content: "No matches found",
        isError: false,
      };
    }
    return {
      toolCallId: toolCall.id,
      content: err instanceof Error ? err.message : "Search failed",
      isError: true,
    };
  }
}
