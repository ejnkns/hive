/** @private — only imported by worker-supervisor.ts */

import { execSync } from "node:child_process";
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
import { getDiff, getStatus } from "./git-operations";
import { commitWork } from "./worker-tools/commit-work";
import { runCommand } from "./worker-tools/run-command";

export const WORKER_TOOLS: ToolDefinition[] = [
  ...DEVISE_TOOLS.filter(
    (tool) => tool.function.name !== "update_requirements_draft"
  ),
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
        "Execute one program in the worktree without a shell. Pass only the executable name in 'command' and every argument as a separate item in 'args'. Compound shell expressions, pipes, redirection, and direct Git mutations are not supported.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "Executable name only, for example 'pnpm', 'git', or 'python3'. Do not include arguments or shell operators.",
          },
          args: {
            type: "array",
            description: "Arguments to pass to the command",
            items: { type: "string" },
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Show the current git working-tree status.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show the current uncommitted git diff.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Show commits on the current worker branch.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "commit_work",
      description:
        "Create a meaningful implementation commit. Declare exactly which relative worktree paths belong in the commit. Repository Git hooks run normally.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "Commit subject following the repository's documented conventions.",
          },
          paths: {
            type: "array",
            description: "Relative files or directories to stage and commit.",
            items: { type: "string" },
          },
        },
        required: ["message", "paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_work",
      description:
        "Submit committed work to the deterministic Completion Gate. This must be the only tool call in the response.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            description: "Either 'implemented' or 'already_satisfied'.",
          },
          verificationCallIds: {
            type: "array",
            description:
              "Successful run_command tool call IDs that verified the current commit.",
            items: { type: "string" },
          },
          verificationNotRunReason: {
            type: "string",
            description:
              "Required instead of verificationCallIds when no applicable automated checks exist.",
          },
          noChangeRationale: {
            type: "string",
            description:
              "Required only for already_satisfied; explain why no implementation commit is needed.",
          },
        },
        required: ["outcome"],
      },
    },
  },
];

export async function executeWorkerTool(
  toolCall: ToolCall,
  workspacePath: string
): Promise<ToolResult> {
  try {
    switch (toolCall.name) {
      case "write_file":
        return writeFile(toolCall, workspacePath);
      case "run_command":
        return await runCommand(toolCall, workspacePath);
      case "commit_work":
        return commitWork(toolCall, workspacePath);
      case "git_status":
        return {
          toolCallId: toolCall.id,
          content: getStatus(workspacePath),
          isError: false,
        };
      case "git_diff":
        return {
          toolCallId: toolCall.id,
          content: getDiff(workspacePath, "HEAD"),
          isError: false,
        };
      case "git_log":
        return {
          toolCallId: toolCall.id,
          content: execSync("git log --oneline --decorate -20", {
            cwd: workspacePath,
            encoding: "utf-8",
            timeout: 5_000,
          }).trim(),
          isError: false,
        };
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

function executeDeviseToolFallback(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  switch (toolCall.name) {
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
