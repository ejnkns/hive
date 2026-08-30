/** @private — the hive-owned default workspace for a flow created without a
 * bound basePath. The invariant: every flow runtime has an absolute basePath
 * (never the daemon's cwd) — a flow that binds no repository gets a dedicated
 * per-flow directory under the hive data dir, created on demand. The resolved
 * path persists with the flow config, so a restart rehydrates onto the same
 * directory. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveHiveDir } from "shared/hive-dir";

export function ensureDefaultWorkspace(flowId: string): string {
  const dir = join(resolveHiveDir(), "workspaces", flowId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
