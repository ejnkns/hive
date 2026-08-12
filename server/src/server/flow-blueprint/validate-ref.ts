/** @private — the shared shape validation for a blueprint-referenced module
 * path: a non-empty relative path ending in `.ts`. Containment within the
 * definition root is enforced structurally by the module-set lint (the lint
 * resolves the path against the materialized root); this validates the shape
 * a reference must have before anything renders. */

import type { BlueprintError } from "./blueprint-types.ts";

export function validateRefShape(ref: unknown, path: string): BlueprintError[] {
  const errors: BlueprintError[] = [];
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

// The export name a reference's stub declares and the entry imports. Derived
// per kind so the lint can check the exact symbol: gates/transforms/extracts
// export the camel-cased file base name; tools export `<id>Tools` (a tool
// list); operations export `<id>Operations` (an ops map).
export function refExportName(
  kind: "gate" | "tool" | "operation" | "transform" | "extract",
  idOrRef: { id: string; ref: string } | { ref: string }
): string {
  if (kind === "tool" || kind === "operation") {
    const id = "id" in idOrRef ? idOrRef.id : fileBaseName(idOrRef.ref);
    return kind === "tool" ? `${id}Tools` : `${id}Operations`;
  }
  return camelCaseId(fileBaseName(idOrRef.ref));
}

export function fileBaseName(ref: string): string {
  const segments = ref.replace(/\\/g, "/").split("/");
  const leaf = segments[segments.length - 1] ?? "";
  return leaf.endsWith(".ts") ? leaf.slice(0, -3) : leaf;
}

// `review-gate.ts` → `reviewGate`; `websearch.ts` → `websearch`.
export function camelCaseId(kebab: string): string {
  return kebab
    .split(/[^A-Za-z0-9_$]+/)
    .filter((part) => part !== "")
    .map((part, index) =>
      index === 0 ? part : part[0].toUpperCase() + part.slice(1)
    )
    .join("");
}
