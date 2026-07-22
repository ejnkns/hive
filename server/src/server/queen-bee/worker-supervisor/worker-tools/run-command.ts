/** @private — only imported by worker-tools.ts */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import { isRecord } from "shared/board-types";
import type { ToolCall, ToolResult } from "../../devise-engine/devise-tools";

const GIT_MUTATIONS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "fetch",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
  "worktree",
]);

export function runCommand(
  toolCall: ToolCall,
  workspacePath: string,
  signal?: AbortSignal,
  timeoutMs = 30_000
): Promise<ToolResult> {
  const parsed: unknown = JSON.parse(toolCall.arguments);
  if (!isRecord(parsed) || typeof parsed.command !== "string") {
    return Promise.resolve(errorResult(toolCall.id, "command is required"));
  }
  if (/\s|[|&;<>`$]/u.test(parsed.command)) {
    return Promise.resolve(
      errorResult(
        toolCall.id,
        "command must contain the executable name only; pass each command argument as a separate item in args"
      )
    );
  }

  const command = parsed.command;
  const args = stringArray(parsed.args);
  if (!args) {
    return Promise.resolve(
      errorResult(toolCall.id, "args must be an array of strings")
    );
  }
  if (
    basename(command) === "git" &&
    args[0] !== undefined &&
    GIT_MUTATIONS.has(args[0])
  ) {
    return Promise.resolve(
      errorResult(
        toolCall.id,
        `direct git ${args[0]} is not allowed; use commit_work for implementation commits and dedicated read-only Git tools for inspection`
      )
    );
  }

  return new Promise<ToolResult>((resolveResult) => {
    execFile(
      command,
      args,
      {
        cwd: workspacePath,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed || error.code === "ETIMEDOUT") {
            resolveResult(
              errorResult(
                toolCall.id,
                `Command timed out after ${timeoutMs}ms: ${commandLine(command, args)}. Do not use run_command to launch interactive or long-running applications; use a finite automated check instead.`
              )
            );
            return;
          }
          resolveResult(
            errorResult(
              toolCall.id,
              [
                `Command failed: ${commandLine(command, args)}`,
                stderr,
                error.message,
              ]
                .filter(Boolean)
                .join("\n")
            )
          );
          return;
        }

        const output: string[] = [];
        if (stdout) output.push(`stdout:\n${stdout}`);
        if (stderr) output.push(`stderr:\n${stderr}`);
        resolveResult({
          toolCallId: toolCall.id,
          content: output.join("\n") || "(no output)",
          isError: false,
        });
      }
    );
  });
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value;
}

function errorResult(toolCallId: string, content: string): ToolResult {
  return { toolCallId, content, isError: true };
}
