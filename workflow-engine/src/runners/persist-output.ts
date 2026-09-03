/** @private — persist helpers for the task-completion and operation-read paths. Imported by create-workflow-instance-controller.ts and re-exported via runners.ts. */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { readFlowSettings, resolveDomainRoot } from "../read-flow-settings.ts";

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

// The placeholders a persist path may reference, substituted from the workflow
// instance when the engine resolves the file location.
export type PersistPathVars = {
  instanceId: string;
  attempt: number;
};

// Resolves a declared persist path to its absolute location under the flow's
// domain root, substituting {instanceId}/{attempt}. Shared by the write and
// read helpers so a task's persist path and an operation that reads the
// output back never drift. The path is confined to the domain root.
export function resolvePersistedPath(
  domainRoot: string,
  persistPath: string,
  vars: PersistPathVars
): string {
  const relativePath = persistPath
    .replaceAll("{instanceId}", vars.instanceId)
    .replaceAll("{attempt}", String(vars.attempt));
  return resolveDomainPath(domainRoot, relativePath);
}

// Writes a task's output to basePath/<domainDir>/<path> on successful
// completion. Format is inferred from the value: a string becomes a text file,
// anything else becomes JSON. The write is atomic (temp file + rename) and the
// resolved path is confined to the domain root. Returns the absolute written
// path.
export function persistOutput(params: PersistOutputParams): string {
  const target = resolvePersistedPath(
    join(params.basePath, params.domainDir),
    params.persistPath,
    { instanceId: params.instanceId, attempt: params.attempt }
  );

  mkdirSync(dirname(target), { recursive: true });
  const content = serializeOutput(params.output);
  const tempPath = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, target);
  return target;
}

// Reads a task's persisted output back at basePath/<domainDir>/<path>,
// returning "" when the file does not exist. The engine owns persist-path
// resolution, so operations read exactly what the engine wrote. A flow
// without a bound basePath/domainDir is a creation-time error, not a silent
// no-op — the caller (e.g. the flow snapshot builder) degrades to empty.
export function readPersistedOutput(
  flowConfig: Record<string, unknown>,
  persistPath: string,
  vars?: PersistPathVars
): string {
  const target = resolvePersistedPath(
    resolveDomainRoot(flowConfig),
    persistPath,
    vars ?? { instanceId: "", attempt: 1 }
  );
  return existsSync(target) ? readFileSync(target, "utf-8") : "";
}

// Lists and reads a persisted directory back at basePath/<domainDir>/<dir>,
// returning { fileName → contents } one level deep (non-recursive) — the
// decisions/ drill-in. Returns {} when the directory does not exist. Mirrors
// readPersistedOutput: the engine owns resolution, so the UI reads exactly the
// files the flow persisted.
export function readPersistedDirectory(
  flowConfig: Record<string, unknown>,
  directoryPath: string
): Record<string, string> {
  const target = resolveDomainPath(
    resolveDomainRoot(flowConfig),
    directoryPath
  );
  if (!existsSync(target)) return {};
  const files: Record<string, string> = {};
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files[entry.name] = readFileSync(join(target, entry.name), "utf-8");
  }
  return files;
}

// Rejects absolute paths and any resolved path that escapes the domain root.
function resolveDomainPath(domainRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Persist path must be relative: ${relativePath}`);
  }
  const root = normalize(domainRoot);
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
