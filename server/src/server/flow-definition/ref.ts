/** @private — the shared shape validation for a definition-referenced module
 * path: a non-empty relative path ending in `.ts`. Containment within the
 * definition root is enforced structurally by the module-set lint (the lint
 * resolves the path against the materialized root); this validates the shape
 * a reference must have before anything compiles. */

import type { DefinitionError } from "workflow-engine/workflow-types";

export function validateRefShape(
  ref: unknown,
  path: string
): DefinitionError[] {
  const errors: DefinitionError[] = [];
  if (typeof ref !== "string" || ref.trim() === "") {
    errors.push({
      path,
      message: `reference path must be a non-empty string (got ${JSON.stringify(ref)})`,
    });
    return errors;
  }
  if (!ref.endsWith(".ts")) {
    errors.push({
      path,
      message: `reference path must end in .ts (got ${JSON.stringify(ref)})`,
    });
  }
  if (ref.startsWith("/") || /^[A-Za-z]:/.test(ref)) {
    errors.push({
      path,
      message: `reference path must be a relative path inside the definition root (got ${JSON.stringify(ref)})`,
    });
  }
  if (!ref.startsWith("./") && !ref.startsWith("../")) {
    errors.push({
      path,
      message: `reference path must start with "./" or "../" so the entry's import resolves relative to the module set (got ${JSON.stringify(ref)})`,
    });
  }
  return errors;
}

// Whether a ref path resolves inside the definition root: no `..` segments
// and not absolute. The lint uses this against the materialized root; the
// shape check above rejects the same escapes earlier where convenient.
export function isRefWithinRoot(ref: string): boolean {
  if (ref.startsWith("/") || /^[A-Za-z]:/.test(ref)) return false;
  return !ref.split("/").some((segment) => segment === "..");
}
