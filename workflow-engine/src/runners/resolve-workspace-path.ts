/** @private — only imported by the ai runners */

import { resolveDottedPath } from "./resolve-dotted-path";

const INSTANCE_REF_PREFIX = "@instance:";

// A task declares its workspace with either a literal path or an @instance: ref
// into the workflow instance state (e.g. "@instance:worktreePath" resolves the
// worktree prepare_worktree recorded). A task without a declared workspace
// operates in the flow's basePath (the bound project repo); with no bound repo
// it falls back to the process cwd, matching the previous no-workspace default.
export function resolveWorkspacePath(
  declared: string | undefined,
  instanceState: Record<string, unknown> | undefined,
  basePath?: string
): string {
  if (declared?.startsWith(INSTANCE_REF_PREFIX)) {
    const resolved = resolveDottedPath(
      instanceState ?? {},
      declared.slice(INSTANCE_REF_PREFIX.length)
    );
    if (typeof resolved === "string" && resolved !== "") return resolved;
    return basePath ?? process.cwd();
  }
  return declared ?? basePath ?? process.cwd();
}
