import type { ConfigField } from "./workflow-types";

// Validates a user-supplied payload against a declared ConfigField set and
// collects the accepted values. Used for manual actions with `fields`: the
// collected values are written into the acting instance's
// workflowInstanceState before the transition, and for the instance-edit form
// (gap 2). Mirrors the server's flow-level createInstance field collection
// (unknown keys rejected, required fields present and non-empty, values
// type-checked) — and is that mirror: the shared validators below are the
// single authority for ConfigField type rules across engine and server.

export type CollectedConfigValues =
  | {
      ok: true;
      values: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

// Canonical formats (see ConfigFieldType in workflow-types.ts):
//   date     → "YYYY-MM-DD"
//   datetime → "YYYY-MM-DDTHH:mm" (optional :ss accepted on read)
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isDateString(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  return isValidCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
}

function isDateTimeString(value: string): boolean {
  const match = DATETIME_RE.exec(value);
  if (!match) return false;
  if (
    !isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  ) {
    return false;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  return hour <= 23 && minute <= 59 && second <= 59;
}

// Whether a value satisfies a ConfigField's declared type. Shared by the
// engine's action-payload collector and the server's instance-config
// validation (flow-registry) so new field types are enforced identically
// everywhere. `options` membership is NOT checked here — see
// configFieldValueError.
export function configValueMatchesType(
  field: ConfigField,
  value: unknown
): boolean {
  switch (field.type) {
    case "string":
    case "textarea":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return typeof value === "string" && isDateString(value);
    case "datetime":
      return typeof value === "string" && isDateTimeString(value);
    case "string[]":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
  }
}

// The specific validation failure for a value against a field, or null when
// accepted. Includes the string[]-with-options closed-set rule, which is a
// constraint beyond the bare type.
export function configFieldValueError(
  field: ConfigField,
  value: unknown
): string | null {
  if (!configValueMatchesType(field, value)) {
    return `Field "${field.key}" must be a ${field.type}`;
  }
  if (
    field.type === "string[]" &&
    field.options !== undefined &&
    Array.isArray(value)
  ) {
    const options = field.options;
    const unknown = value.filter((item) => !options.includes(item));
    if (unknown.length > 0) {
      return `Field "${field.key}" has values outside the allowed options: ${unknown.join(", ")}`;
    }
  }
  return null;
}

// An empty string (whitespace-only) or an empty array counts as a missing
// value for required-field checks.
export function isEmptyConfigFieldValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function collectConfigFieldValues(
  fields: ConfigField[],
  payload: Record<string, unknown>
): CollectedConfigValues {
  const declared = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!declared.has(key)) {
      return { ok: false, error: `Unknown field "${key}"` };
    }
  }

  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = payload[field.key];
    if (value === undefined) {
      if (field.required) {
        return { ok: false, error: `Missing required field "${field.key}"` };
      }
      continue;
    }
    if (field.required && isEmptyConfigFieldValue(value)) {
      return {
        ok: false,
        error: `Required field "${field.key}" cannot be empty`,
      };
    }
    const failure = configFieldValueError(field, value);
    if (failure !== null) {
      return { ok: false, error: failure };
    }
    // Dedupe a multi-select's values on write.
    values[field.key] =
      field.type === "string[]" && Array.isArray(value)
        ? [...new Set(value)]
        : value;
  }
  return { ok: true, values };
}
