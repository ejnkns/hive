/** @private — the referenced-file read/write core, shared by the file tools
 * (the agent path) and the authoring routes (the editor's file tabs). Both
 * write to the module-set working directory — the file IS the truth (no
 * divergence machinery for files) — and record the result on the session's
 * file set. Only flow-authoring/session/tools/* and the definition routes
 * import from here. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { refPathInDir } from "../../flow-definitions.ts";
import {
  AUTHORING_MODULE_SET,
  type AuthoringItemState,
  authoringModuleSetDir,
} from "./state.ts";

export type AuthoringFileWrite =
  | { ok: true; files: Record<string, string> }
  | { ok: false; message: string };

// Writes a referenced file into the module-set working directory and returns
// the session's updated file set (the caller patches it into instance state).
// `path` is relative to the definition root; the definition module (flow.ts)
// is the entry, not a referenced file — set_flow_definition changes it.
export function writeAuthoringModuleFile(
  state: AuthoringItemState,
  path: string,
  content: string
): AuthoringFileWrite {
  if (path === "" || path === "flow.ts") {
    return {
      ok: false,
      message:
        "path is required and must name a referenced file (flow.ts is the definition module — set_flow_definition changes it)",
    };
  }
  if (content.trim() === "") {
    return { ok: false, message: "content is required" };
  }
  const target = refPathInDir(
    authoringModuleSetDir(state.moduleSetSlug ?? AUTHORING_MODULE_SET),
    path
  );
  if (target === undefined) {
    return {
      ok: false,
      message: `path must stay inside the definition root (got "${path}")`,
    };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
  const key = path.startsWith("./") ? path : `./${path}`;
  return { ok: true, files: { ...(state.files ?? {}), [key]: content } };
}

export type AuthoringFileRead =
  | { ok: true; content: string }
  | { ok: false; message: string };

// Seeds a set of files (an existing definition's referenced files being
// revised) into the session's module-set working directory, returning the
// merged file set the caller patches into instance state. Each file goes
// through the same containment-checked write as the write_definition_file
// tool — a seeded file is authoritative, never overwritten by stub emission.
export function seedAuthoringModuleFiles(
  state: AuthoringItemState,
  files: Record<string, string>
): AuthoringFileWrite {
  let merged = { ...(state.files ?? {}) };
  for (const [path, content] of Object.entries(files)) {
    const result = writeAuthoringModuleFile(state, path, content);
    if (!result.ok) return result;
    merged = result.files;
  }
  return { ok: true, files: merged };
}

export function readAuthoringModuleFile(
  state: AuthoringItemState,
  path: string
): AuthoringFileRead {
  if (path === "" || path === "flow.ts") {
    return {
      ok: false,
      message:
        "path is required and must name a referenced file (flow.ts is the definition module — set_flow_definition changes it)",
    };
  }
  const target = refPathInDir(
    authoringModuleSetDir(state.moduleSetSlug ?? AUTHORING_MODULE_SET),
    path
  );
  if (target === undefined) {
    return {
      ok: false,
      message: `path must stay inside the definition root (got "${path}")`,
    };
  }
  if (!existsSync(target)) {
    return {
      ok: false,
      message: `no file at "${path}" — validate the definition first (the gate checks every referenced file)`,
    };
  }
  return { ok: true, content: readFileSync(target, "utf-8") };
}
