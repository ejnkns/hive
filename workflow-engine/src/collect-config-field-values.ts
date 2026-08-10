import type { ConfigField } from "./workflow-types";

// Validates a user-supplied payload against a declared ConfigField set and
// collects the accepted values. Used for manual actions with `fields`: the
// collected values are written into the acting instance's
// workflowInstanceState before the transition. Mirrors the server's
// flow-level createInstance field collection (unknown keys rejected, required
// fields present and non-empty, values type-checked).

export type CollectedConfigValues =
  | {
      ok: true;
      values: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

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
    if (field.required && typeof value === "string" && value.trim() === "") {
      return {
        ok: false,
        error: `Required field "${field.key}" cannot be empty`,
      };
    }
    const matchesType =
      (field.type === "string" && typeof value === "string") ||
      (field.type === "boolean" && typeof value === "boolean") ||
      (field.type === "number" && typeof value === "number");
    if (!matchesType) {
      return {
        ok: false,
        error: `Field "${field.key}" must be a ${field.type}`,
      };
    }
    values[field.key] = value;
  }
  return { ok: true, values };
}
