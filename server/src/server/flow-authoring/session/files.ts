/** @private — the referenced-file read/write core, shared by the file tools
 * (the agent path) and the authoring routes (the editor's file tabs). Both
 * write to the module-set working directory — the file IS the truth (no
 * divergence machinery for files) — and record the result on the session's
 * file set. Only flow-authoring/session/tools/* and the definition routes
 * import from here. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { refPathInDir } from "../../flow-definitions.ts";
import { type AuthoringItemState, authoringModuleSetDir } from "./state.ts";

export type AuthoringFileWrite =
  | { ok: true; files: Record<string, string> }
  | { ok: false; message: string };

// Writes a referenced file into the module-set working directory and returns
// the session's updated file set (the caller patches it into instance state).
// `path` is relative to the definition root; the rendered entry (flow.ts) is
// not a referenced file — edit the blueprint to change it.
export function writeAuthoringModuleFile(
  state: AuthoringItemState,
  path: string,
  content: string
): AuthoringFileWrite {
  if (path === "" || path === "flow.ts") {
    return {
      ok: false,
      message:
        "path is required and must name a referenced file (flow.ts is the rendered entry — edit the blueprint instead)",
    };
  }
  if (content.trim() === "") {
    return { ok: false, message: "content is required" };
  }
  const target = refPathInDir(authoringModuleSetDir(), path);
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

export function readAuthoringModuleFile(path: string): AuthoringFileRead {
  if (path === "" || path === "flow.ts") {
    return {
      ok: false,
      message:
        "path is required and must name a referenced file (flow.ts is the rendered entry — edit the blueprint instead)",
    };
  }
  const target = refPathInDir(authoringModuleSetDir(), path);
  if (target === undefined) {
    return {
      ok: false,
      message: `path must stay inside the definition root (got "${path}")`,
    };
  }
  if (!existsSync(target)) {
    return {
      ok: false,
      message: `no file at "${path}" — generate the definition first (the gate emits a stub for every referenced file)`,
    };
  }
  return { ok: true, content: readFileSync(target, "utf-8") };
}
