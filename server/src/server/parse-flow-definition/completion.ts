/** @private — the generated completion-tool reader: the `<wf>CompletionTools`
 * arrays the renderer emits (from a task's completionOutput) reversed back
 * into per-task CompletionOutputField lists. Only tools inside these arrays
 * are reversed; a task's completionTool that names anything else stays as-is
 * or surfaces a finding. */

import ts from "typescript";
import type { CompletionOutputField, FieldType } from "../flow-blueprint.ts";
import { unwrap } from "../schema-consistency.ts";
import { literalJson, property, readString } from "./read.ts";

// tool name → the declared completion fields (the renderer emits all fields
// as required — the blueprint's completionOutput carries no required flag).
export function readCompletionTools(
  elements: ts.NodeArray<ts.Expression>
): Map<string, CompletionOutputField[]> {
  const byName = new Map<string, CompletionOutputField[]>();
  for (const element of elements) {
    const tool = toolLiteral(element);
    if (tool === undefined) continue;
    const name = readString(tool, "name");
    if (name === undefined) continue;
    const fields = completionFieldsOf(tool);
    if (fields === undefined) continue;
    byName.set(name, fields);
  }
  return byName;
}

// `defineTool({ ... })` → the tool literal (or the bare literal for a
// hand-written tool object).
function toolLiteral(
  element: ts.Expression
): ts.ObjectLiteralExpression | undefined {
  const value = unwrap(element);
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) {
    return ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  if (value.expression.text !== "defineTool") return undefined;
  const arg = value.arguments[0];
  return arg !== undefined && ts.isObjectLiteralExpression(arg)
    ? arg
    : undefined;
}

// The `parameters.properties` schema → the completion contract fields.
function completionFieldsOf(
  tool: ts.ObjectLiteralExpression
): CompletionOutputField[] | undefined {
  const parameters = property(tool, "parameters");
  if (!parameters) return undefined;
  const parametersValue = unwrap(parameters.initializer);
  if (!ts.isObjectLiteralExpression(parametersValue)) return undefined;
  const properties = property(parametersValue, "properties");
  if (!properties) return undefined;
  const propertiesValue = unwrap(properties.initializer);
  if (!ts.isObjectLiteralExpression(propertiesValue)) return undefined;

  const fields: CompletionOutputField[] = [];
  for (const prop of propertiesValue.properties) {
    if (!ts.isPropertyAssignment(prop)) return undefined;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (name === undefined) return undefined;
    const schemaValue = unwrap(prop.initializer);
    if (!ts.isObjectLiteralExpression(schemaValue)) return undefined;
    const type = completionFieldType(schemaValue);
    if (type === undefined) return undefined;
    const field: CompletionOutputField = { field: name, type };
    const description = readString(schemaValue, "description");
    if (description !== undefined) field.description = description;
    fields.push(field);
  }
  return fields;
}

// The emitted property schema `{ type, items?, description? }` → FieldType.
function completionFieldType(
  schema: ts.ObjectLiteralExpression
): FieldType | undefined {
  const type = readString(schema, "type");
  if (type === undefined) return undefined;
  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "object":
      return type;
    case "array": {
      const items = property(schema, "items");
      if (!items) return undefined;
      const itemsValue = unwrap(items.initializer);
      if (!ts.isObjectLiteralExpression(itemsValue)) return undefined;
      const itemType = readString(itemsValue, "type");
      switch (itemType) {
        case "string":
          return "string[]";
        case "number":
          return "number[]";
        case "boolean":
          return "boolean[]";
        case "object":
          return "object[]";
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

// The generated completion tool name for a task: `<wf>_<task>_complete`.
export function completionToolName(workflowId: string, taskId: string): string {
  return `${workflowId}_${taskId}_complete`;
}

// The `required` list of a completion tool's parameters (the renderer marks
// every declared field required; the blueprint has no required flag — a
// mismatch between required and properties is hand-written).
export function requiredFieldsOf(
  tool: ts.ObjectLiteralExpression
): string[] | undefined {
  const parameters = property(tool, "parameters");
  if (!parameters) return undefined;
  const parametersValue = unwrap(parameters.initializer);
  if (!ts.isObjectLiteralExpression(parametersValue)) return undefined;
  const required = property(parametersValue, "required");
  if (!required) return undefined;
  const requiredValue = unwrap(required.initializer);
  if (!ts.isArrayLiteralExpression(requiredValue)) return undefined;
  const names: string[] = [];
  for (const element of requiredValue.elements) {
    const item = unwrap(element);
    if (!ts.isStringLiteral(item)) return undefined;
    names.push(item.text);
  }
  return names;
}

// A generic helper used by the parse's findings: the tool's executor must
// never be read back (it is generated); its presence is assumed.
export function toolExecutorPresent(tool: ts.ObjectLiteralExpression): boolean {
  return property(tool, "executor") !== undefined;
}

// The full parameters object of a completion tool as JSON (the description
// etc. live on the tool literal, not the blueprint).
export function toolParametersJson(tool: ts.ObjectLiteralExpression): unknown {
  const parameters = property(tool, "parameters");
  if (!parameters) return undefined;
  return literalJson(parameters.initializer);
}
