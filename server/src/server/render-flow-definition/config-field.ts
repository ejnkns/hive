/** @private — ConfigField rendering (bare authoring style: identifier-named
 * keys so the schema-consistency check can resolve them). */

import { json, jsonValue } from "./render-primitives.ts";

export function renderConfigField(f: {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string | boolean | number | string[];
  options?: string[];
}): string {
  const parts = [
    `key: ${json(f.key)}`,
    `label: ${json(f.label)}`,
    `type: ${json(f.type)}`,
  ];
  if (f.required !== undefined) parts.push(`required: ${f.required}`);
  if (f.hint) parts.push(`hint: ${json(f.hint)}`);
  if (f.placeholder) parts.push(`placeholder: ${json(f.placeholder)}`);
  if (f.defaultValue !== undefined)
    parts.push(`defaultValue: ${jsonValue(f.defaultValue)}`);
  if (f.options) parts.push(`options: [${f.options.map(json).join(", ")}]`);
  return `{ ${parts.join(", ")} }`;
}

export function renderConfigFields(
  fields: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    hint?: string;
    placeholder?: string;
    defaultValue?: string | boolean | number | string[];
    options?: string[];
  }[]
): string {
  return fields.map(renderConfigField).join(", ");
}

// ─── gate rendering ───────────────────────────────────────────────────
