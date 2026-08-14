/** @private — the gate-closure matcher: the `(ctx) => ...` closure bodies the
 * renderer emits (render-gate.ts) reversed back into structured GateSpecs.
 * The matcher is total over the renderer's emission — every combinator, the
 * task/state/error-count predicates, and file refs — and returns undefined
 * for a body the renderer never produces (the caller reports the finding). */

import ts from "typescript";
import type { GateSpec } from "../flow-blueprint.ts";
import { unwrap } from "../schema-consistency.ts";
import { type ParseContext, refPathFor } from "./context.ts";
import { literalScalar } from "./read.ts";

export function parseGate(
  expr: ts.Expression,
  context: ParseContext,
  path: string
): GateSpec | undefined {
  const value = unwrap(expr);

  if (value.kind === ts.SyntaxKind.TrueKeyword) return { kind: "always" };
  if (value.kind === ts.SyntaxKind.FalseKeyword) return { kind: "never" };
  if (isCtxHasRunningTask(value)) return { kind: "hasRunningTask" };

  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operand = value.operand;
    const operandInner = unwrap(operand);
    // `!ctx.hasRunningTask` (bare — no parens) is the noRunningTask
    // emission; `!(...)` is a `not` gate.
    if (
      isCtxHasRunningTask(operandInner) &&
      !ts.isParenthesizedExpression(operand)
    ) {
      return { kind: "noRunningTask" };
    }
    const inner = parseGate(operandInner, context, `${path}.gate`);
    if (inner === undefined) return undefined;
    return { kind: "not", gate: inner };
  }

  if (ts.isBinaryExpression(value)) {
    const operator = value.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      const gates = flattenBinary(value, operator, context, path);
      return gates === undefined ? undefined : { kind: "and", gates };
    }
    if (operator === ts.SyntaxKind.BarBarToken) {
      const gates = flattenBinary(value, operator, context, path);
      return gates === undefined ? undefined : { kind: "or", gates };
    }
    if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      return parseEqualityGate(value);
    }
    if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
      return parseErrorCountGate(value);
    }
  }

  // A referenced gate file: `<binding>(ctx)`.
  if (
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.arguments.length === 1 &&
    ts.isIdentifier(value.arguments[0]) &&
    value.arguments[0].text === "ctx"
  ) {
    const binding = value.expression.text;
    const ref = refPathFor(context, binding);
    if (ref === undefined) return undefined;
    context.refs.push({
      kind: "gate",
      ref,
      exportName: context.bindings.get(binding)?.exportName ?? binding,
      path,
    });
    return { kind: "file", ref };
  }

  return undefined;
}

// Left-associative && / || chains flatten into the gates list in source order;
// the nested-gate path mirrors the renderer's reference inventory
// (`gate.gates[i]`).
function flattenBinary(
  node: ts.BinaryExpression,
  operator: ts.SyntaxKind,
  context: ParseContext,
  path: string
): GateSpec[] | undefined {
  const gates: GateSpec[] = [];
  const stack: ts.Expression[] = [node];
  while (stack.length > 0) {
    const current = unwrap(stack.pop() ?? node);
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === operator
    ) {
      stack.push(current.right, current.left);
      continue;
    }
    const gate = parseGate(current, context, `${path}.gates[${gates.length}]`);
    if (gate === undefined) return undefined;
    gates.push(gate);
  }
  return gates;
}

// `left === <literal>`: the task-output status/equals predicates and the
// instance-state equals predicate.
function parseEqualityGate(node: ts.BinaryExpression): GateSpec | undefined {
  const value = literalScalar(unwrap(node.right));
  if (value === undefined) return undefined;
  const chain = chainSegments(unwrap(node.left));
  if (chain === undefined || chain.base !== "ctx") return undefined;
  const reversed = [...chain.segments].reverse();
  if (
    reversed.length >= 2 &&
    reversed[0]?.name === "taskOutputs" &&
    !reversed[0].optional &&
    reversed[1] !== undefined &&
    !reversed[1].optional
  ) {
    const task = reversed[1].name;
    const rest = reversed.slice(2);
    if (!rest.every((segment) => segment.optional)) return undefined;
    const names = rest.map((segment) => segment.name);
    if (names.length === 1 && names[0] === "status") {
      if (value === "success") return { kind: "taskSuccess", task };
      if (value === "error") return { kind: "taskError", task };
      return undefined; // a status compared with anything else is hand-written
    }
    return {
      kind: "taskOutputEquals",
      task,
      path: names.join("."),
      value,
    };
  }
  if (
    reversed.length === 2 &&
    reversed[0]?.name === "workflowInstanceState" &&
    !reversed[0].optional &&
    reversed[1] !== undefined &&
    !reversed[1].optional
  ) {
    return { kind: "instanceStateEquals", field: reversed[1].name, value };
  }
  return undefined;
}

// `(ctx.taskErrorCounts.<task> ?? 0) >= <count>`.
function parseErrorCountGate(node: ts.BinaryExpression): GateSpec | undefined {
  const count = literalScalar(unwrap(node.right));
  if (typeof count !== "number") return undefined;
  const left = unwrap(node.left);
  if (
    !ts.isBinaryExpression(left) ||
    left.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
  ) {
    return undefined;
  }
  if (!isZeroLiteral(unwrap(left.right))) return undefined;
  const chain = chainSegments(unwrap(left.left));
  if (chain === undefined || chain.base !== "ctx") return undefined;
  const reversed = [...chain.segments].reverse();
  if (
    reversed.length !== 2 ||
    reversed[0]?.name !== "taskErrorCounts" ||
    reversed[0].optional ||
    reversed[1] === undefined ||
    reversed[1].optional
  ) {
    return undefined;
  }
  return { kind: "errorCountAtLeast", task: reversed[1].name, count };
}

function isCtxHasRunningTask(expr: ts.Expression): boolean {
  const chain = chainSegments(expr);
  return (
    chain !== undefined &&
    chain.base === "ctx" &&
    chain.segments.length === 1 &&
    chain.segments[0]?.name === "hasRunningTask" &&
    !chain.segments[0].optional
  );
}

function isZeroLiteral(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  return ts.isNumericLiteral(value) && value.text === "0";
}

// A property-access chain with its base identifier, top-most segment first
// (`ctx.taskOutputs.plan?.output?.kind` → base "ctx", segments
// [kind?, output?, plan, taskOutputs]).
function chainSegments(
  expr: ts.Expression
):
  | { segments: { name: string; optional: boolean }[]; base: string }
  | undefined {
  const segments: { name: string; optional: boolean }[] = [];
  let current = unwrap(expr);
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      segments.push({
        name: current.name.text,
        optional:
          (current as ts.PropertyAccessChain).questionDotToken !== undefined,
      });
      current = unwrap(current.expression);
      continue;
    }
    if (ts.isIdentifier(current)) return { segments, base: current.text };
    return undefined;
  }
}
