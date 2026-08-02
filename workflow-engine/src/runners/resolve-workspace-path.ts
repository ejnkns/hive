/** @private — only imported by the ai runners */

const INSTANCE_REF_PREFIX = "@instance:";

// A task declares its workspace with either a literal path or an @instance: ref
// into the workflow instance state (e.g. "@instance:worktreePath" resolves the
// worktree prepare_worktree recorded). An unresolvable or non-string ref falls
// back to the process cwd, matching the previous no-workspace default.
export function resolveWorkspacePath(
  declared: string | undefined,
  instanceState: Record<string, unknown> | undefined
): string {
  if (declared?.startsWith(INSTANCE_REF_PREFIX)) {
    const resolved = readDottedPath(
      instanceState ?? {},
      declared.slice(INSTANCE_REF_PREFIX.length)
    );
    if (typeof resolved === "string" && resolved !== "") return resolved;
    return process.cwd();
  }
  return declared ?? process.cwd();
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
