/** @private — only imported by the ai runners */

import { resolveDottedPath } from "./resolve-dotted-path.ts";

const INSTANCE_REF_PREFIX = "@instance:";

// A task declares its workspace with either a literal path or an @instance: ref
// into the workflow instance state (e.g. "@instance:worktreePath" resolves the
// worktree prepare_worktree recorded). A task without a declared workspace
// operates in the flow's basePath (the bound project repo or the hive-owned
// default). There is NO fallback to the daemon's cwd — a task with neither a
// declared workspace nor a bound basePath is an error, never an accident.
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
    if (basePath !== undefined) return basePath;
    throw new Error(
      "No workspace to operate in: the workspacePath ref did not resolve and the flow has no basePath — declare a workspacePath or bind a basePath (never the daemon's cwd)"
    );
  }
  if (declared !== undefined) return declared;
  if (basePath !== undefined) return basePath;
  throw new Error(
    "No workspace to operate in: the task declares no workspacePath and the flow has no basePath — declare a workspacePath or bind a basePath (never the daemon's cwd)"
  );
}
