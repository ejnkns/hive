/** @private — only imported by the ai runners */

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
    const resolved = readDottedPath(
      instanceState ?? {},
      declared.slice(INSTANCE_REF_PREFIX.length)
    );
    if (typeof resolved === "string" && resolved !== "") return resolved;
    return basePath ?? process.cwd();
  }
  return declared ?? basePath ?? process.cwd();
}

function readDottedPath(
  state: Record<string, unknown>,
  dottedPath: string
): unknown {
  let current: unknown = state;
  for (const segment of dottedPath.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
