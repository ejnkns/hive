import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolDefinition, ToolExecutor } from "../tool-types";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_directory",
    description:
      "List files and folders in a directory relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path relative to workspace root. Use '.' for root.",
        },
      },
      required: ["path"],
    },
  },
};

export const execute: ToolExecutor = async (call, ctx) => {
  const args = JSON.parse(call.arguments) as { path?: string };
  const requested =
    typeof args.path === "string" && args.path ? args.path : ".";

  if (ctx.projectRevision) {
    const prefix = normalizePrefix(requested);
    const files = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", ctx.projectRevision],
      {
        cwd: ctx.workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      }
    )
      .split("\n")
      .filter(Boolean);
    const entries = new Set<string>();
    for (const file of files) {
      if (!file.startsWith(prefix)) continue;
      const rem = file.slice(prefix.length);
      const [name, ...rest] = rem.split("/");
      if (!name || name.startsWith(".")) continue;
      entries.add(rest.length > 0 ? `${prefix}${name}/` : `${prefix}${name}`);
    }
    return {
      toolCallId: call.id,
      content: [...entries].sort().join("\n") || "(empty)",
      isError: false,
    };
  }

  const dirPath = resolve(ctx.workspacePath, requested);
  const entries = readdirSync(dirPath, { withFileTypes: true });
  // Hidden entries are included: the flow's domain state lives in a dot
  // directory (.queen-bee/requirements.md is the authoritative spec a worker
  // or coordinator must be able to discover). .git is the only noise.
  const listing = entries
    .map((e) => {
      const relP = relative(ctx.workspacePath, join(dirPath, e.name));
      return e.isDirectory() ? `${relP}/` : relP;
    })
    .sort()
    .join("\n");
  return { toolCallId: call.id, content: listing || "(empty)", isError: false };
};

function normalizePrefix(path: string): string {
  const normalized = path.replace(/^\.\//, "").replace(/\/$/, "") || ".";
  return normalized === "." ? "" : `${normalized}/`;
}
