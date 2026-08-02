/** @private — persist helper for the task-completion path. Only imported by create-workflow-instance-controller.ts. */

import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export type PersistOutputParams = {
  output: unknown;
  // Declared task persist path (e.g. "requirements.md" or
  // "reviews/{instanceId}-{attempt}.json"); placeholders are substituted from
  // the workflow instance.
  persistPath: string;
  basePath: string;
  domainDir: string;
  instanceId: string;
  attempt: number;
};

// Writes a task's output to basePath/<domainDir>/<path> on successful
// completion. Format is inferred from the value: a string becomes a text file,
// anything else becomes JSON. The write is atomic (temp file + rename) and the
// resolved path is confined to the domain root. Returns the absolute written
// path.
export function persistOutput(params: PersistOutputParams): string {
  const relativePath = substitutePathPlaceholders(params);
  const target = resolveDomainPath(
    params.basePath,
    params.domainDir,
    relativePath
  );

  mkdirSync(dirname(target), { recursive: true });
  const content = serializeOutput(params.output);
  const tempPath = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, target);
  return target;
}

function substitutePathPlaceholders(params: PersistOutputParams): string {
  return params.persistPath
    .replaceAll("{instanceId}", params.instanceId)
    .replaceAll("{attempt}", String(params.attempt));
}

// Rejects absolute paths and any resolved path that escapes the domain root.
function resolveDomainPath(
  basePath: string,
  domainDir: string,
  relativePath: string
): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Persist path must be relative: ${relativePath}`);
  }
  const root = normalize(join(basePath, domainDir));
  const target = normalize(join(root, relativePath));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Persist path escapes the domain root: ${relativePath}`);
  }
  return target;
}

function serializeOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) {
    throw new Error("Cannot persist undefined task output");
  }
  return JSON.stringify(output, null, 2);
}
