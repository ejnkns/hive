/** @private — only imported by reviewer.ts */

import { execFileSync } from "node:child_process";
import { isRecord } from "shared/board-types";
import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../devise-engine/devise-tools";
import { AGENT_TOOLS, executeAgentTool } from "../devise-engine/devise-tools";

export const REVIEWER_TOOLS: ToolDefinition[] = [
  ...AGENT_TOOLS.filter((tool) =>
    ["list_directory", "read_file", "search_code"].includes(tool.function.name)
  ),
  simpleTool("git_diff", "Show the complete committed worker branch diff."),
  simpleTool("git_log", "Show commits on the worker branch."),
  {
    type: "function",
    function: {
      name: "git_show",
      description: "Read a committed file at a specific revision.",
      parameters: {
        type: "object",
        properties: {
          revision: {
            type: "string",
            description: "Commit SHA or HEAD.",
          },
          path: {
            type: "string",
            description: "Relative file path to read at the revision.",
          },
        },
        required: ["revision", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_review",
      description:
        "Submit the terminal structured review. This must be the only tool call in the response.",
      parameters: {
        type: "object",
        properties: {
          verdict: {
            type: "string",
            enum: ["approved", "changes_requested"],
            description: "The review recommendation.",
          },
          findings: {
            type: "array",
            description: "Concrete review findings supported by evidence.",
            items: {
              type: "object",
              properties: {
                severity: {
                  type: "string",
                  enum: ["blocking", "warning"],
                },
                requirement: { type: "string" },
                evidence: { type: "string" },
                recommendation: { type: "string" },
              },
              required: [
                "severity",
                "requirement",
                "evidence",
                "recommendation",
              ],
            },
          },
          verificationAssessment: {
            type: "object",
            description: "Assessment of the submitted verification evidence.",
            properties: {
              status: {
                type: "string",
                enum: ["sufficient", "insufficient"],
              },
              notes: { type: "string" },
            },
            required: ["status", "notes"],
          },
        },
        required: ["verdict", "findings", "verificationAssessment"],
      },
    },
  },
];

export function executeReviewerTool(
  toolCall: ToolCall,
  workspacePath: string,
  baseCommit: string
): ToolResult {
  try {
    switch (toolCall.name) {
      case "list_directory":
      case "read_file":
      case "search_code":
        return executeAgentTool(toolCall, workspacePath);
      case "git_diff":
        return success(
          toolCall.id,
          git(workspacePath, ["diff", "--no-ext-diff", `${baseCommit}...HEAD`])
        );
      case "git_log":
        return success(
          toolCall.id,
          git(workspacePath, [
            "log",
            "--oneline",
            "--decorate",
            `${baseCommit}..HEAD`,
          ])
        );
      case "git_show":
        return showCommittedFile(toolCall, workspacePath);
      default:
        return {
          toolCallId: toolCall.id,
          content: "Unknown tool",
          isError: true,
        };
    }
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      content: error instanceof Error ? error.message : "Inspection failed",
      isError: true,
    };
  }
}

function showCommittedFile(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const parsed: unknown = JSON.parse(toolCall.arguments);
  if (
    !isRecord(parsed) ||
    typeof parsed.revision !== "string" ||
    typeof parsed.path !== "string" ||
    parsed.revision.startsWith("-") ||
    parsed.path.startsWith("-")
  ) {
    return {
      toolCallId: toolCall.id,
      content: "revision and relative path are required",
      isError: true,
    };
  }
  return success(
    toolCall.id,
    git(workspacePath, ["show", `${parsed.revision}:${parsed.path}`])
  );
}

function simpleTool(name: string, description: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

function git(workspacePath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspacePath,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function success(toolCallId: string, content: string): ToolResult {
  return { toolCallId, content: content || "(no output)", isError: false };
}
