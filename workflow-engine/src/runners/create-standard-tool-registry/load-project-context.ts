/** @private — only imported by create-standard-tool-registry.ts */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskDefinition } from "../../task-runner";
import { runGit } from "../git-command";

export function loadProjectContext(
  _task: TaskDefinition,
  params: Record<string, unknown>
): Record<string, unknown> {
  // Operation inputs arrive as an erased record; read the known fields with
  // runtime narrowing instead of asserting the whole params shape.
  const basePath = typeof params.basePath === "string" ? params.basePath : "";
  const manifestPaths = Array.isArray(params.manifestPaths)
    ? params.manifestPaths.filter((p): p is string => typeof p === "string")
    : undefined;
  const cacheRoot =
    typeof params.cacheRoot === "string" ? params.cacheRoot : undefined;

  if (!basePath) {
    return { ok: false, error: "Missing required param: basePath" };
  }

  try {
    const revision = runGit(basePath, ["rev-parse", "HEAD"]);
    // Content-addressed cache keyed by revision, outside the repo so it never
    // pollutes or is committed with the project.
    const cacheDir = cacheRoot ?? join(tmpdir(), "hive-project-context");
    const cachePath = join(cacheDir, `${revision}.json`);

    // Try cache
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<
        string,
        unknown
      >;
      return { ok: true, ...cached };
    } catch {
      /* cache miss */
    }

    const files = gitLines(basePath, [
      "ls-tree",
      "-r",
      "--name-only",
      revision,
    ]);
    const manifests: Record<string, string> = {};
    for (const manifestPath of manifestPaths ?? ["package.json", "README.md"]) {
      try {
        manifests[manifestPath] = runGit(basePath, [
          "show",
          `${revision}:${manifestPath}`,
        ]);
      } catch {
        /* file not found at revision */
      }
    }

    const result = {
      revision,
      files,
      manifests,
      digest: createHash("sha256").update(files.join("\n")).digest("hex"),
    };

    mkdirSync(cacheDir, { recursive: true });
    const tmp = join(cacheDir, `${revision}.${randomHex()}.tmp`);
    writeFileSync(tmp, JSON.stringify(result, null, 2), "utf-8");
    renameSync(tmp, cachePath);

    return { ok: true, ...result };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Project context failed",
    };
  }
}

function randomHex(): string {
  return createHash("sha256")
    .update(Math.random().toString())
    .digest("hex")
    .slice(0, 12);
}

function gitLines(cwd: string, args: string[]): string[] {
  return runGit(cwd, args, 10_000).split("\n").filter(Boolean);
}
