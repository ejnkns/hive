/** @private — only imported by worker-tools.ts */

import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCall, ToolResult } from "../../devise-engine/devise-tools";

const PROTECTED_PATHS = new Set([".hive/requirements.md"]);

export function commitWork(
  toolCall: ToolCall,
  workspacePath: string
): ToolResult {
  const parsed: unknown = JSON.parse(toolCall.arguments);
  if (!isRecord(parsed) || typeof parsed.message !== "string") {
    return errorResult(toolCall.id, "message is required");
  }
  const message = parsed.message.trim();
  if (!message) return errorResult(toolCall.id, "message is required");

  const paths = stringArray(parsed.paths);
  if (!paths || paths.length === 0) {
    return errorResult(toolCall.id, "paths must contain at least one path");
  }

  const normalizedPaths: string[] = [];
  for (const path of paths) {
    const normalized = relative(workspacePath, resolve(workspacePath, path));
    if (!normalized || normalized.startsWith("..") || isAbsolute(normalized)) {
      return errorResult(toolCall.id, `Path escapes worktree: ${path}`);
    }
    if (PROTECTED_PATHS.has(normalized)) {
      return errorResult(
        toolCall.id,
        `${normalized} is managed by the Devise workflow and cannot be committed by a Worker Agent`
      );
    }
    normalizedPaths.push(normalized);
  }

  try {
    execFileSync("git", ["add", "-A", "--", ...normalizedPaths], {
      cwd: workspacePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    const stagedFiles = gitLines(workspacePath, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
    ]);
    if (stagedFiles.length === 0) {
      return errorResult(toolCall.id, "Declared paths contain no changes");
    }
    const unexpected = stagedFiles.filter(
      (file) => !normalizedPaths.some((path) => includesPath(path, file))
    );
    if (unexpected.length > 0) {
      return errorResult(
        toolCall.id,
        `Refusing to include previously staged paths: ${unexpected.join(", ")}`
      );
    }

    execFileSync("git", ["commit", "-m", message], {
      cwd: workspacePath,
      encoding: "utf-8",
      timeout: 60_000,
    });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspacePath,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
    return {
      toolCallId: toolCall.id,
      content: JSON.stringify({ commit, files: stagedFiles }),
      isError: false,
    };
  } catch (error) {
    return errorResult(
      toolCall.id,
      error instanceof Error ? error.message : "Commit failed"
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value;
}

function gitLines(workspacePath: string, args: string[]): string[] {
  return execFileSync("git", args, {
    cwd: workspacePath,
    encoding: "utf-8",
    timeout: 5_000,
  })
    .split("\n")
    .filter(Boolean);
}

function includesPath(declaredPath: string, file: string): boolean {
  return file === declaredPath || file.startsWith(`${declaredPath}/`);
}

function errorResult(toolCallId: string, content: string): ToolResult {
  return { toolCallId, content, isError: true };
}
