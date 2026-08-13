/** @private — shared regexes and engine-capability sets the blueprint validators use. */

import { engineCapabilities } from "workflow-engine/capabilities-manifest";
import type { FieldType, ModuleRefKind } from "./blueprint-types.ts";

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A loose npm package name: unscoped (`axios`) or scoped (`@scope/pkg`). The
// blueprint's dependencies list holds package names — imports of those
// packages (any subpath) are allowed by the import policy.
export const PACKAGE_NAME = /^(@[A-Za-z0-9-._~]+\/)?[A-Za-z0-9-._~]+$/;

// The closed vocabulary of blueprint-referenced module kinds — the contract
// kinds the engine scaffolds stubs and lint for. Declared up front so the
// system stays principled; expanding means adding a kind here and the
// contract/render/lint wiring for it.
export const MODULE_REF_KINDS: readonly ModuleRefKind[] = [
  "gate",
  "tool",
  "operation",
  "transform",
  "extract",
  "prompt",
];
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
