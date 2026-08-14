/** @private — the definition parser's literal readers (relocated from the
 * reverse renderer): find the flow object literal in a definition module and
 * read its scalar values, config fields, board columns, display fields,
 * instance-state declarations, and the vocabulary objects (gates, values,
 * tasks, edges) as data. Everything here is a plain read of the pure-data
 * module — no anchors, no type aliases, no generated machinery to reverse
 * (the definition declares them directly). */

import ts from "typescript";
import type {
  BoardColumn,
  ConfigField,
  DerivedDisplay,
} from "workflow-engine/workflow-types";
import { parseFile, unwrap } from "../schema-consistency.ts";

export type ObjectLiteral = ts.ObjectLiteralExpression;

export function parseEntrySource(entry: string): ts.SourceFile {
  return parseFile({ path: "flow.ts", source: entry });
}

// The flow literal: the object in `export const flow: FlowDefinition = {
// ... }` (with or without the `satisfies` clause).
export function findFlowLiteral(
  sourceFile: ts.SourceFile
): ObjectLiteral | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExport = statement.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!isExport) continue;
    const declaration = statement.declarationList.declarations[0];
    if (
      !declaration ||
      !ts.isIdentifier(declaration.name) ||
      declaration.name.text !== "flow" ||
      !declaration.initializer
    ) {
      continue;
    }
    const literal = unwrap(declaration.initializer);
    return ts.isObjectLiteralExpression(literal) ? literal : undefined;
  }
  return undefined;
}

// ─── scalar readers ───────────────────────────────────────────────────

export function readString(
  obj: ObjectLiteral,
  key: string
): string | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return undefined;
}

export function readBool(obj: ObjectLiteral, key: string): boolean | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function readNumber(
  obj: ObjectLiteral,
  key: string
): number | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  return undefined;
}

export function readStringArray(
  obj: ObjectLiteral,
  key: string
): string[] | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  if (!ts.isArrayLiteralExpression(value)) return undefined;
  const out: string[] = [];
  for (const element of value.elements) {
    const item = unwrap(element);
    if (!ts.isStringLiteral(item)) return undefined;
    out.push(item.text);
  }
  return out;
}

export function readObject(
  obj: ObjectLiteral,
  key: string
): ObjectLiteral | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  return ts.isObjectLiteralExpression(value) ? value : undefined;
}

export function readArray(
  obj: ObjectLiteral,
  key: string
): ts.NodeArray<ts.Expression> | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const value = unwrap(prop.initializer);
  return ts.isArrayLiteralExpression(value) ? value.elements : undefined;
}

// The property assignment for a key (identifier or string-literal name).
export function property(
  obj: ObjectLiteral,
  key: string
): ts.PropertyAssignment | undefined {
  const found = obj.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      ((ts.isIdentifier(p.name) && p.name.text === key) ||
        (ts.isStringLiteral(p.name) && p.name.text === key))
  );
  return found;
}

// Every property name of an object literal (identifiers and string literals).
export function propertyNames(obj: ObjectLiteral): string[] {
  const names: string[] = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (ts.isIdentifier(prop.name)) names.push(prop.name.text);
    else if (ts.isStringLiteral(prop.name)) names.push(prop.name.text);
  }
  return names;
}

// A literal value expression → the JSON-ish value it carries (string /
// number / boolean / null / array / object). The data vocabulary objects
// (gates, value specs, operationInputs, derive hints, render hints) are plain
// literal objects — parse them here instead of re-evaluating.
export function literalJson(expr: ts.Expression): unknown {
  const value = unwrap(expr);
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.map((element) => literalJson(element));
  }
  if (ts.isObjectLiteralExpression(value)) {
    const out: Record<string, unknown> = {};
    for (const prop of value.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : undefined;
      if (name === undefined) continue;
      out[name] = literalJson(prop.initializer);
    }
    return out;
  }
  return undefined;
}

// A scalar literal — string/number/boolean (a leading minus is a numeric
// literal under a prefix unary node).
export function literalScalar(
  expr: ts.Expression
): string | number | boolean | undefined {
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken
  ) {
    const operand = unwrap(expr.operand);
    if (ts.isNumericLiteral(operand)) return -Number(operand.text);
    return undefined;
  }
  const value = unwrap(expr);
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

// ─── structured literal readers ──────────────────────────────────────

// A ConfigField in the definition's bare authoring style:
//   { key, label, type, required?, hint?, placeholder?, defaultValue?, options? }
export function readConfigField(obj: ObjectLiteral): ConfigField | undefined {
  const key = readString(obj, "key");
  const label = readString(obj, "label");
  const type = readString(obj, "type");
  if (key === undefined || label === undefined || type === undefined) {
    return undefined;
  }
  const field: ConfigField = { key, label, type: type as ConfigField["type"] };
  const required = readBool(obj, "required");
  if (required !== undefined) field.required = required;
  const hint = readString(obj, "hint");
  if (hint !== undefined) field.hint = hint;
  const placeholder = readString(obj, "placeholder");
  if (placeholder !== undefined) field.placeholder = placeholder;
  const defaultValueProp = property(obj, "defaultValue");
  if (defaultValueProp !== undefined) {
    const value = literalJson(defaultValueProp.initializer);
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"))
    ) {
      field.defaultValue = value as ConfigField["defaultValue"];
    }
  }
  const optionsProp = property(obj, "options");
  if (optionsProp !== undefined) {
    const options = readStringArrayFromExpr(optionsProp.initializer);
    if (options !== undefined) field.options = options;
  }
  return field;
}

function readStringArrayFromExpr(expr: ts.Expression): string[] | undefined {
  const value = unwrap(expr);
  if (!ts.isArrayLiteralExpression(value)) return undefined;
  const out: string[] = [];
  for (const element of value.elements) {
    const item = unwrap(element);
    if (!ts.isStringLiteral(item)) return undefined;
    out.push(item.text);
  }
  return out;
}

export function readConfigFields(
  array: ts.NodeArray<ts.Expression> | undefined,
  path: string,
  findings: string[]
): ConfigField[] {
  if (array === undefined) return [];
  const fields: ConfigField[] = [];
  array.forEach((element, index) => {
    const item = unwrap(element);
    if (!ts.isObjectLiteralExpression(item)) {
      findings.push(
        `${path}[${index}]: not data — a config field must be an object literal`
      );
      return;
    }
    const field = readConfigField(item);
    if (field === undefined) {
      findings.push(
        `${path}[${index}]: not data — a config field must carry key, label, and type`
      );
      return;
    }
    fields.push(field);
  });
  return fields;
}

export function readBoardColumns(
  array: ts.NodeArray<ts.Expression> | undefined,
  path: string,
  findings: string[]
): BoardColumn[] | undefined {
  if (array === undefined) return undefined;
  const columns: BoardColumn[] = [];
  array.forEach((element, index) => {
    const item = unwrap(element);
    if (!ts.isObjectLiteralExpression(item)) {
      findings.push(
        `${path}[${index}]: not data — a board column must be an object literal`
      );
      return;
    }
    const id = readString(item, "id");
    const label = readString(item, "label");
    const states = readStringArray(item, "states");
    if (id === undefined || label === undefined || states === undefined) {
      findings.push(
        `${path}[${index}]: not data — a board column must carry id, label, and states`
      );
      return;
    }
    columns.push({ id, label, states });
  });
  return columns;
}

// A display field: `{ path, label?, render?, derive? }` — the render hint and
// derive are literal objects in the data module.
export type DisplayFieldRead = {
  path: string;
  label?: string;
  render?: { kind: string; props?: Record<string, string> };
  derive?: DerivedDisplay;
};

export function readDisplayFields(
  array: ts.NodeArray<ts.Expression> | undefined,
  path: string,
  findings: string[]
): DisplayFieldRead[] | undefined {
  if (array === undefined) return undefined;
  const fields: DisplayFieldRead[] = [];
  array.forEach((element, index) => {
    const item = unwrap(element);
    if (!ts.isObjectLiteralExpression(item)) {
      findings.push(
        `${path}[${index}]: not data — a display field must be an object literal`
      );
      return;
    }
    const fieldPath = readString(item, "path");
    if (fieldPath === undefined) {
      findings.push(
        `${path}[${index}]: not data — a display field must carry a path`
      );
      return;
    }
    const field: DisplayFieldRead = { path: fieldPath };
    const label = readString(item, "label");
    if (label !== undefined) field.label = label;
    const renderProp = property(item, "render");
    if (renderProp !== undefined) {
      const hint = literalJson(renderProp.initializer);
      if (typeof hint === "string") {
        field.render = { kind: hint };
      } else if (
        typeof hint === "object" &&
        hint !== null &&
        typeof (hint as Record<string, unknown>).kind === "string"
      ) {
        const raw = hint as Record<string, unknown>;
        field.render = { kind: raw.kind as string };
        if (raw.props !== undefined && typeof raw.props === "object") {
          field.render.props = raw.props as Record<string, string>;
        }
      } else {
        findings.push(
          `${path}[${index}].render: not data — a render hint must be a kind string or a { kind, props? } object`
        );
      }
    }
    const deriveProp = property(item, "derive");
    if (deriveProp !== undefined) {
      const derive = literalJson(deriveProp.initializer);
      if (derive !== undefined) field.derive = derive as DerivedDisplay;
    }
    fields.push(field);
  });
  return fields;
}

// An instance-state declaration: `{ field, type }` — the definition's declared
// fields replace the type-alias anchor.
export function readInstanceState(
  array: ts.NodeArray<ts.Expression> | undefined,
  path: string,
  findings: string[]
): { field: string; type: string }[] {
  if (array === undefined) return [];
  const fields: { field: string; type: string }[] = [];
  array.forEach((element, index) => {
    const item = unwrap(element);
    if (!ts.isObjectLiteralExpression(item)) {
      findings.push(
        `${path}[${index}]: not data — an instance-state field must be an object literal`
      );
      return;
    }
    const field = readString(item, "field");
    const type = readString(item, "type");
    if (field === undefined || type === undefined) {
      findings.push(
        `${path}[${index}]: not data — an instance-state field must carry field and type`
      );
      return;
    }
    fields.push({ field, type });
  });
  return fields;
}
