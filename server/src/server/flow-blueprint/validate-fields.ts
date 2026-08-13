/** @private — ConfigField / DerivedDisplay / FieldType shape guards. */

import type {
  ConfigField,
  DerivedDisplay,
} from "workflow-engine/workflow-types";
import { FIELD_TYPES } from "./blueprint-constants.ts";
import type { BlueprintError, FieldType } from "./blueprint-types.ts";

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && value in FIELD_TYPES;
}

// A render hint (a task's or display field's `render`) must be the wire shape
// the engine consumes — an object with a string `kind` (builtin or custom)
// and an optional string→string props map. A bare string or a missing kind is
// a model mistake the renderer would otherwise emit as broken TypeScript
// ("Type 'string' is not assignable to type 'RuntimeRenderHint'") deep in
// the generated entry — catch it here with a readable finding instead.
export function renderHintErrors(
  value: unknown,
  path: string
): BlueprintError[] {
  const errors: BlueprintError[] = [];
  // A bare string is the kind shorthand — the renderer normalizes it to
  // { kind: <string> } for the definition.
  if (typeof value === "string") {
    if (value.trim() === "") {
      errors.push({
        path,
        message: `render must be a non-empty kind string or an object with a kind (e.g. "markdown" or { kind: "markdown" })`,
      });
    }
    return errors;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({
      path,
      message: `render must be a kind string or an object with a kind (e.g. "markdown" or { kind: "markdown" }), got ${JSON.stringify(value)}`,
    });
    return errors;
  }
  const hint = value as Record<string, unknown>;
  if (typeof hint.kind !== "string" || hint.kind.trim() === "") {
    errors.push({
      path: `${path}.kind`,
      message: `render.kind is required and must be a string (builtin kinds: markdown, text, card, cards, json — or a custom kind)`,
    });
  }
  if (
    hint.props !== undefined &&
    (typeof hint.props !== "object" ||
      hint.props === null ||
      Array.isArray(hint.props) ||
      Object.values(hint.props).some((p) => typeof p !== "string"))
  ) {
    errors.push({
      path: `${path}.props`,
      message: `render.props must be an object mapping prop names to dotted paths (got ${JSON.stringify(hint.props)})`,
    });
  }
  return errors;
}

// A derived display field entry: count/progress need a where clause with a
// string field and a scalar equals value (progress's where is required); sum
// takes an optional string item field. countAcross/progressAcross aggregate
// over the workflow's instances: equals must be scalar (progressAcross's is
// required; countAcross's is optional — absent means all instances).
export function isDerivedDisplay(value: unknown): value is DerivedDisplay {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  if (
    d.kind !== "count" &&
    d.kind !== "progress" &&
    d.kind !== "sum" &&
    d.kind !== "countAcross" &&
    d.kind !== "progressAcross"
  ) {
    return false;
  }
  const where = d.where as Record<string, unknown> | undefined;
  if (where !== undefined) {
    if (typeof where !== "object" || where === null) return false;
    if (typeof where.field !== "string") return false;
    const equals = where.equals;
    if (
      typeof equals !== "string" &&
      typeof equals !== "number" &&
      typeof equals !== "boolean"
    ) {
      return false;
    }
  }
  if (d.kind === "progress" && where === undefined) return false;
  if (d.field !== undefined && typeof d.field !== "string") return false;
  const equals = d.equals;
  if (
    equals !== undefined &&
    typeof equals !== "string" &&
    typeof equals !== "number" &&
    typeof equals !== "boolean"
  ) {
    return false;
  }
  if (d.kind === "progressAcross" && equals === undefined) return false;
  return true;
}

export function isConfigField(value: unknown): value is ConfigField {
  if (typeof value !== "object" || value === null) return false;
  const field = value as Record<string, unknown>;
  return (
    typeof field.key === "string" &&
    typeof field.label === "string" &&
    (field.type === "string" ||
      field.type === "boolean" ||
      field.type === "number" ||
      field.type === "textarea" ||
      field.type === "date" ||
      field.type === "datetime" ||
      field.type === "string[]") &&
    (field.options === undefined ||
      (Array.isArray(field.options) &&
        field.options.every((o) => typeof o === "string")))
  );
}
