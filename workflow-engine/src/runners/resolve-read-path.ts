/** @public — the read-path resolver for the file tools: a requested path
 * resolves within the task's workspace first, then within each session-granted
 * extra read root. A path the human handed over in chat (or a flow declared in
 * its config) is reachable even when it lies outside the workspace. */

import { isAbsolute, relative, resolve, sep } from "node:path";

// Resolves a tool-requested path to an absolute file path, or undefined when
// it escapes every allowed root (the workspace + extra read roots).
export function resolveReadPath(
  requested: string,
  workspacePath: string,
  extraReadRoots: readonly string[] | undefined
): string | undefined {
  const workspaceResolved = resolve(workspacePath, requested);
  if (isWithinRoot(workspacePath, workspaceResolved)) return workspaceResolved;
  for (const root of extraReadRoots ?? []) {
    const rootResolved = resolve(root, requested);
    if (isWithinRoot(root, rootResolved)) return rootResolved;
  }
  return undefined;
}

// Whether a target path stays inside a root directory.
export function isWithinRoot(root: string, targetPath: string): boolean {
  const rel = relative(resolve(root), targetPath);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}
