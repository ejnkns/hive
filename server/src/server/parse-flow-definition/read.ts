/** @private — AST literal readers for the reverse renderer: find the flow /
 * workflow / state / task / action object literals in a rendered definition
 * entry and read their scalar values, config fields, board columns, display
 * fields, and instance-state type aliases. Everything here is a plain read —
 * the shape matchers (gates, values, completion, refs) live beside it. */

import ts from "typescript";
import type {
  BoardColumn,
  ConfigField,
  DerivedDisplay,
} from "workflow-engine/workflow-types";
import type { FieldType } from "../flow-blueprint.ts";
import { parseFile, unwrap } from "../schema-consistency.ts";
import { notSpecRepresentable } from "./findings.ts";

export type ObjectLiteral = ts.ObjectLiteralExpression;

export function parseEntrySource(entry: string): ts.SourceFile {
  return parseFile({ path: "flow.ts", source: entry });
}

// The flow literal: the object in `export const flow = { ... } satisfies
// FlowDefinition;`.
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

// A module-level `const <name> = ...` anywhere in the file (workflow configs,
// ops maps, completion tools, type aliases are declared at module level; the
// workflow consts are not exported).
export function findModuleConst(
  sourceFile: ts.SourceFile,
  name: string
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

// The workflow config literal: `const <ref> = defineWorkflow({ ... });`.
export function workflowConfigLiteral(
  sourceFile: ts.SourceFile,
  ref: string
): ObjectLiteral | undefined {
  const initializer = findModuleConst(sourceFile, ref);
  if (!initializer) return undefined;
  const expr = unwrap(initializer);
  if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) {
    return undefined;
  }
  if (expr.expression.text !== "defineWorkflow") return undefined;
  const arg = expr.arguments[0];
  return arg !== undefined && ts.isObjectLiteralExpression(arg)
    ? arg
    : undefined;
}

// The type alias `<name> = { ... }` member list.
export function typeAliasMembers(
  sourceFile: ts.SourceFile,
  name: string
): ts.NodeArray<ts.TypeElement> | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) {
      continue;
    }
    return ts.isTypeLiteralNode(statement.type)
      ? statement.type.members
      : undefined;
  }
  return undefined;
}

// The `<f>?: <T>;` members of an instance-state type alias → FieldType list.
export function instanceStateFromAlias(
  sourceFile: ts.SourceFile,
  aliasName: string
): { field: string; type: FieldType }[] | undefined {
  const members = typeAliasMembers(sourceFile, aliasName);
  if (members === undefined) return undefined;
  const fields: { field: string; type: FieldType }[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) {
      return undefined;
    }
    const name = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteral(member.name)
        ? member.name.text
        : undefined;
    if (name === undefined) return undefined;
    const type = fieldTypeFromTypeNode(member.type);
    if (type === undefined) return undefined;
    fields.push({ field: name, type });
  }
  return fields;
}

// The emitted instance-state type node → blueprint FieldType.
export function fieldTypeFromTypeNode(
  node: ts.TypeNode
): FieldType | undefined {
  if (isKeywordKind(node.kind)) {
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword:
        return "string";
      case ts.SyntaxKind.NumberKeyword:
        return "number";
      case ts.SyntaxKind.BooleanKeyword:
        return "boolean";
      default:
        return undefined;
    }
  }
  if (ts.isArrayTypeNode(node) && isKeywordKind(node.elementType.kind)) {
    switch (node.elementType.kind) {
      case ts.SyntaxKind.StringKeyword:
        return "string[]";
      case ts.SyntaxKind.NumberKeyword:
        return "number[]";
      case ts.SyntaxKind.BooleanKeyword:
        return "boolean[]";
      default:
        return undefined;
    }
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    if (node.typeName.text === "Record" && node.typeArguments?.length === 2) {
      return "object";
    }
    if (node.typeName.text === "Array" && node.typeArguments?.length === 1) {
      return "object[]";
    }
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

// An array of bare identifiers (`workflows: [cardsWf, ideasWf]` — the renderer
// references the workflow consts by name, not by string).
export function readIdentifierArray(
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
    if (!ts.isIdentifier(item)) return undefined;
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

// The anchor's type name: `{} as <Type>` → "<Type>"; `{} as Record<string,
// unknown>` → "Record". The `as` wrapper must be read before unwrapping
// (unwrap strips casts).
export function anchorTypeName(
  obj: ObjectLiteral,
  key: string
): string | undefined {
  const prop = property(obj, key);
  if (!prop) return undefined;
  const initializer = prop.initializer;
  if (!ts.isAsExpression(initializer)) return undefined;
  if (!ts.isTypeReferenceNode(initializer.type)) return undefined;
  return ts.isIdentifier(initializer.type.typeName)
    ? initializer.type.typeName.text
    : undefined;
}

// A literal value expression → the JSON-ish value it carries (string /
// number / boolean / null / array / object). The renderer emits several
// JSON-stringified payloads as raw object literals (operationInputs, derive,
// render hints) — parse them here instead of re-evaluating.
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

// A scalar literal the renderer emits via json() — string/number/boolean
// (a leading minus is a numeric literal under a prefix unary node).
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

// Is this kind a string/number/boolean keyword type node?
function isKeywordKind(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.StringKeyword ||
    kind === ts.SyntaxKind.NumberKeyword ||
    kind === ts.SyntaxKind.BooleanKeyword
  );
}

// ─── structured literal readers ──────────────────────────────────────

// A ConfigField in the renderer's bare authoring style:
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
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a config field must be an object literal"
      );
      return;
    }
    const field = readConfigField(item);
    if (field === undefined) {
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a config field must carry key, label, and type"
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
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a board column must be an object literal"
      );
      return;
    }
    const id = readString(item, "id");
    const label = readString(item, "label");
    const states = readStringArray(item, "states");
    if (id === undefined || label === undefined || states === undefined) {
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a board column must carry id, label, and states"
      );
      return;
    }
    columns.push({ id, label, states });
  });
  return columns;
}

// A display field: `{ path, label?, render?, derive? }` — the render hint and
// derive are JSON-stringified object literals in the emission.
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
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a display field must be an object literal"
      );
      return;
    }
    const fieldPath = readString(item, "path");
    if (fieldPath === undefined) {
      notSpecRepresentable(
        findings,
        `${path}[${index}]`,
        "a display field must carry a path"
      );
      return;
    }
    const field: DisplayFieldRead = { path: fieldPath };
    const label = readString(item, "label");
    if (label !== undefined) field.label = label;
    const renderProp = property(item, "render");
    if (renderProp !== undefined) {
      const hint = literalJson(renderProp.initializer);
      if (
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
        notSpecRepresentable(
          findings,
          `${path}[${index}].render`,
          "a display render hint must be a { kind, props? } object"
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
