/** @private — ConfigField / DerivedDisplay / FieldType shape guards. */

import type {
  ConfigField,
  DerivedDisplay,
  FieldType,
} from "workflow-engine/workflow-types";
import { FIELD_TYPES } from "./constants.ts";

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && value in FIELD_TYPES;
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
