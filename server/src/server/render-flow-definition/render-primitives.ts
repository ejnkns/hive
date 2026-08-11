/** @private — the renderer's shared string primitives: identifier casing,
 * JSON emission, and FieldType → emitted TS type mappings. */

import type { FieldType } from "../flow-spec.ts";

export function pascal(id: string): string {
  return id.length === 0 ? "" : id[0].toUpperCase() + id.slice(1);
}

export function json(value: string | number | boolean): string {
  return JSON.stringify(value);
}

export function jsonValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? `[${value.map(json).join(", ")}]` : json(value);
}

export function fieldType(type: FieldType): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
      return "string[]";
    case "number[]":
      return "number[]";
    case "boolean[]":
      return "boolean[]";
    case "object":
      return "Record<string, unknown>";
    case "object[]":
      return "Array<Record<string, unknown>>";
    default:
      return "unknown";
  }
}

// The JSON-schema type a completion tool parameter derives from a FieldType
// (array kinds carry their item type in `items`).
export function schemaType(type: FieldType): string {
  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "object":
      return type;
    case "string[]":
    case "number[]":
    case "boolean[]":
    case "object[]":
      return "array";
    default:
      return "string";
  }
}

// The cast a value sourced from a task output / item path needs to satisfy
// the declared field type (the source is `unknown` at the point of access).
export function castTo(type: FieldType): string {
  return `as ${fieldType(type)} | undefined`;
}

// ConfigField rendered in bare authoring style (bare `key:` identifiers, not
// JSON.stringify's quoted keys — the schema-consistency check resolves
// createInstance payload keys through identifier-named properties).
