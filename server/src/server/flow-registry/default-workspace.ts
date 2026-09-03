/** @private — the hive-owned default workspace a flow is bound to when it is
 * created without an explicit basePath: a flow that binds no repository gets
 * a dedicated per-flow directory under the hive data dir, created on demand.
 * The resolved path persists with the flow config, so a restart rehydrates
 * onto the same directory.
 *
 * The basePath contract has three layers — keep them distinct:
 *  - CREATION normalizes: an absent basePath becomes this default workspace,
 *    "~" is expanded, a relative path is rejected (the daemon's cwd is never
 *    a stable anchor).
 *  - The ENGINE enforces: a present basePath must be absolute, and a
 *    persist-declaring flow must have one (create-flow-runtime.ts).
 *  - REHYDRATION does not mutate persisted config: flow config is immutable
 *    after creation, so a legacy flow that violates the contract is skipped
 *    with a warning, never silently repaired.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveHiveDir } from "shared/hive-dir";

export function ensureDefaultWorkspace(flowId: string): string {
  const dir = join(resolveHiveDir(), "workspaces", flowId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
