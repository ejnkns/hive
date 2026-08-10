/** @private — shared regexes and engine-capability sets the spec validators use. */

import { engineCapabilities } from "workflow-engine/capabilities-manifest";
import type { FieldType } from "./spec-types";

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
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
