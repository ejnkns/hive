/** @private — instance config validation against a definition's configSchema. */

import {
  configFieldValueError,
  isEmptyConfigFieldValue,
} from "workflow-engine/collect-config-field-values";
import type { ConfigField } from "workflow-engine/workflow-types";
import { getFlowDefinition } from "../flow-definitions.ts";

// ── Instance config validation ──
//
// The definition's configSchema is the exact contract for client-supplied
// config at instantiation: required fields present with the right type, no
// unknown fields. The instance `name` is universal and validated alongside.
// Internal fields (definitionId, targetBranch, workspacesBasePath) are added
// by the server or engine and are never accepted from the client. Enforced at
// the API boundary; createFlow itself stays permissive for internal callers.
export function validateInstanceConfig(
  definitionId: string,
  config: Record<string, unknown>
): string[] {
  const definition = getFlowDefinition(definitionId);
  if (!definition) {
    return [`Flow definition "${definitionId}" not registered`];
  }

  const errors: string[] = [];
  const schema = definition.configSchema ?? [];
  const allowedKeys = new Set([...schema.map((field) => field.key), "name"]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown config field "${key}"`);
    }
  }

  for (const field of schema) {
    const value = config[field.key];
    if (value === undefined) {
      if (field.required) errors.push(`Missing required field "${field.key}"`);
      continue;
    }
    if (field.required && isEmptyConfigFieldValue(value)) {
      errors.push(`Required field "${field.key}" cannot be empty`);
      continue;
    }
    if (!configValueMatchesType(field, value)) {
      errors.push(`Config field "${field.key}" must be a ${field.type}`);
    }
  }

  if (typeof config.name !== "string" || config.name === "") {
    errors.push('Missing required field "name"');
  }

  return errors;
}

// Value type-matching delegated to the shared engine validator so every
// ConfigField type (string[]/date/datetime/...) is enforced identically here
// and in the engine. Options membership is part of the shared check too.
function configValueMatchesType(field: ConfigField, value: unknown): boolean {
  return configFieldValueError(field, value) === null;
}
