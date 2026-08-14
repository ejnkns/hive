/** @private — shared regexes and engine-capability sets the definition validator uses. */

import { engineCapabilities } from "workflow-engine/capabilities-manifest";
import type { FieldType } from "workflow-engine/workflow-types";

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A loose npm package name: unscoped (`axios`) or scoped (`@scope/pkg`). The
// definition's dependencies list holds package names — imports of those
// packages (any subpath) are allowed by the import policy.
export const PACKAGE_NAME = /^(@[A-Za-z0-9-._~]+\/)?[A-Za-z0-9-._~]+$/;

export const DOTTED_PATH =
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export const infraToolNames = new Set<string>(
  engineCapabilities.infrastructureTools.map((t) => t.name)
);
export const engineOpNames = new Set<string>(
  engineCapabilities.engineOperations.map((o) => o.name)
);
export const engineOpWritesByName = new Map<string, Set<string>>(
  engineCapabilities.engineOperations.map((o) => [o.name, new Set(o.writes)])
);
export const ENGINE_PROVIDED = new Set(
  Object.keys(engineCapabilities.stateFields.engineProvided)
);

export const FIELD_TYPES: Record<FieldType, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  "string[]": "string[]",
  "number[]": "number[]",
  "boolean[]": "boolean[]",
  object: "object",
  "object[]": "Array<Record<string, unknown>>",
};

// The engine's builtin render kinds (a definition may declare custom kinds in
// ui.kinds and reference them freely).
export const BUILTIN_RENDER_KINDS: readonly string[] = [
  "markdown",
  "text",
  "card",
  "cards",
  "json",
];
