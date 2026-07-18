/** @private — only imported by create-devise-model-caller.ts */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterSchema>;
      required: string[];
    };
  };
};

export type ToolParameterSchema = {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
  isError: boolean;
};

export const DEVISE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "update_requirements_draft",
      description:
        "Replace the session's proposed requirements draft. This never mutates the canonical requirements document. Call this whenever answers change the draft and pass the full document so the user can see live updates.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The full requirements document in markdown format, including all sections (Overview, Functional requirements, Acceptance criteria, Out of scope, For later).",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and folders in a directory relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to project root. Use '.' for root.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to project root.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
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
  },
];

export function executeDeviseTool(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  try {
    switch (toolCall.name) {
      case "update_requirements_draft":
        return updateRequirementsDraft(toolCall);
      case "list_directory":
        return listDirectory(toolCall, workspacePath);
      case "read_file":
        return readFile(toolCall, workspacePath);
      case "search_code":
        return searchCode(toolCall, workspacePath);
      default:
        return {
          toolCallId: toolCall.id,
          content: `Unknown tool: ${toolCall.name}`,
          isError: true,
        };
    }
  } catch (err) {
    return {
      toolCallId: toolCall.id,
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

function updateRequirementsDraft(toolCall: ToolCall): ToolResult {
  const args = JSON.parse(toolCall.arguments) as { content?: string };
  if (!args.content) {
    return {
      toolCallId: toolCall.id,
      content: "content is required",
      isError: true,
    };
  }

  return {
    toolCallId: toolCall.id,
    content: "Requirements draft updated for explicit user approval",
    isError: false,
  };
}

function listDirectory(toolCall: ToolCall, workspacePath: string): ToolResult {
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

function readFile(toolCall: ToolCall, workspacePath: string): ToolResult {
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

function searchCode(toolCall: ToolCall, workspacePath: string): ToolResult {
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
