/** @private — shared tool definitions for Queen Bee agents */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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

export const AGENT_TOOLS: ToolDefinition[] = [
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

export function executeAgentTool(
  toolCall: ToolCall,
  workspacePath: string,
  projectRevision?: string
): ToolResult {
  try {
    switch (toolCall.name) {
      case "update_requirements_draft":
        return updateRequirementsDraft(toolCall);
      case "list_directory":
        return listDirectory(toolCall, workspacePath, projectRevision);
      case "read_file":
        return readFile(toolCall, workspacePath, projectRevision);
      case "search_code":
        return searchCode(toolCall, workspacePath, projectRevision);
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
  const args = toolArguments(toolCall);
  if (typeof args.content !== "string" || !args.content) {
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

function listDirectory(
  toolCall: ToolCall,
  workspacePath: string,
  projectRevision?: string
): ToolResult {
  const args = toolArguments(toolCall);
  const requestedPath =
    typeof args.path === "string" && args.path ? args.path : ".";
  if (projectRevision) {
    const normalizedPath = normalizeRelativePath(requestedPath);
    const prefix = normalizedPath === "." ? "" : `${normalizedPath}/`;
    const files = git(workspacePath, [
      "ls-tree",
      "-r",
      "--name-only",
      projectRevision,
    ])
      .split("\n")
      .filter(Boolean)
      .filter((file) => file.startsWith(prefix));
    const entries = new Set<string>();
    for (const file of files) {
      const remainder = file.slice(prefix.length);
      const [name, ...rest] = remainder.split("/");
      if (!name || (name.startsWith(".") && name !== ".hive")) continue;
      entries.add(rest.length > 0 ? `${prefix}${name}/` : `${prefix}${name}`);
    }
    return {
      toolCallId: toolCall.id,
      content: [...entries].sort().join("\n") || "(empty)",
      isError: false,
    };
  }
  const dirPath = resolve(workspacePath, requestedPath);

  if (!isWithinWorkspace(workspacePath, dirPath)) {
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

function readFile(
  toolCall: ToolCall,
  workspacePath: string,
  projectRevision?: string
): ToolResult {
  const args = toolArguments(toolCall);
  if (typeof args.path !== "string" || !args.path) {
    return {
      toolCallId: toolCall.id,
      content: "path is required",
      isError: true,
    };
  }
  if (projectRevision) {
    const path = normalizeRelativePath(args.path);
    const content = git(workspacePath, ["show", `${projectRevision}:${path}`]);
    if (Buffer.byteLength(content, "utf-8") > 100_000) {
      return {
        toolCallId: toolCall.id,
        content: `File is larger than 100000 bytes`,
        isError: true,
      };
    }
    return { toolCallId: toolCall.id, content, isError: false };
  }

  const filePath = resolve(workspacePath, args.path);
  if (!isWithinWorkspace(workspacePath, filePath)) {
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

function searchCode(
  toolCall: ToolCall,
  workspacePath: string,
  projectRevision?: string
): ToolResult {
  const args = toolArguments(toolCall);
  if (typeof args.pattern !== "string" || !args.pattern) {
    return {
      toolCallId: toolCall.id,
      content: "pattern is required",
      isError: true,
    };
  }

  try {
    if (projectRevision) {
      const result = git(workspacePath, [
        "grep",
        "-n",
        "-e",
        args.pattern,
        projectRevision,
        "--",
      ]);
      const lines = result.split("\n").filter(Boolean);
      return {
        toolCallId: toolCall.id,
        content:
          lines.slice(0, 100).join("\n") +
          (lines.length > 100
            ? `\n... (${String(lines.length - 100)} more matches)`
            : ""),
        isError: false,
      };
    }
    const result = execFileSync(
      "rg",
      ["-n", "--no-heading", "-e", args.pattern, "."],
      {
        cwd: workspacePath,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      }
    );

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
    const status = errorProperty(err, "status");
    const stderr = errorProperty(err, "stderr");
    if (String(stderr ?? "").includes("No such file") || status === 1) {
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

function toolArguments(toolCall: ToolCall): Record<string, unknown> {
  const value: unknown = JSON.parse(toolCall.arguments);
  if (!isRecord(value)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorProperty(error: unknown, property: "status" | "stderr"): unknown {
  return isRecord(error) ? error[property] : undefined;
}

function isWithinWorkspace(workspacePath: string, targetPath: string): boolean {
  const relativePath = relative(resolve(workspacePath), targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function normalizeRelativePath(path: string): string {
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

function git(workspacePath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspacePath,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  }).trim();
}
