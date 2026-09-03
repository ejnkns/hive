/** @public — the session read-grant: paths the human explicitly handed the
 * agent in chat, resolved to absolute read roots the file tools may access
 * alongside the task's workspace. A user message that is itself one
 * path-like token grants that path (the user typed it deliberately);
 * prose grants nothing. */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ChatMessage } from "../workflow-types.ts";

// The grant test: the whole trimmed message is a single path-like token.
// Bare names ("effect") are ambiguous and grant nothing; a trailing slash
// ("effect/") is an explicit directory reference and does grant.
export function grantedPathFromMessage(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return undefined;
  const withoutSlash = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  if (withoutSlash.startsWith("/") || withoutSlash.startsWith("~/")) {
    return withoutSlash;
  }
  if (withoutSlash.startsWith("./") || withoutSlash.startsWith("../")) {
    return withoutSlash;
  }
  // A bare directory reference ("effect/") is an explicit grant.
  if (trimmed.endsWith("/")) return withoutSlash;
  return undefined;
}

// Every granted path across the transcript's user messages, resolved to an
// absolute read root (relative grants resolve against the flow's basePath;
// `~/` expands the home directory).
export function resolveGrantedRoots(
  messages: readonly Pick<ChatMessage, "role" | "content">[],
  basePath: string | undefined
): string[] {
  const roots: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const granted = grantedPathFromMessage(message.content);
    if (granted === undefined) continue;
    roots.push(resolveGrantedPath(granted, basePath));
  }
  return roots;
}

function resolveGrantedPath(
  granted: string,
  basePath: string | undefined
): string {
  if (granted.startsWith("~/")) {
    return resolve(homedir(), granted.slice(2));
  }
  if (isAbsolute(granted)) return granted;
  if (basePath === undefined) {
    throw new Error(
      "Cannot resolve a relative granted path without a flow basePath — the engine never resolves against the daemon's cwd"
    );
  }
  return resolve(basePath, granted);
}
