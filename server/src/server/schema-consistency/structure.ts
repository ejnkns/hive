/** @private — structural soundness of the state machine itself: reachability
 * and exit analysis, advisory only (never fails the gate). */

import ts from "typescript";
import type { ObjectLiteral } from "./ast";
import { arrayOf, propertyOf, stringValue, unwrap } from "./ast";

export function assessWorkflowStructure(
  config: ObjectLiteral,
  workflowId: string
): string[] {
  const warnings: string[] = [];

  const initial = stringValue(propertyOf(config, "initial")?.initializer);
  const terminalStates = new Set(
    (arrayOf(config, "terminalStates") ?? [])
      .map((expr) => stringValue(expr))
      .filter((value): value is string => value !== undefined)
  );

  // A state is a dead-end when it has neither autoTransitions nor actions
  // (transitions are the only way a state changes). Terminal states and
  // states whose category says terminal are exempt.
  const states = new Map<string, { hasExit: boolean }>();
  const transitions: Array<{
    from: string;
    to: string | undefined;
    gate: ts.Expression | undefined;
  }> = [];

  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    const id = stringValue(propertyOf(stateExpr, "id")?.initializer);
    if (id === undefined) continue;
    const category = stringValue(
      propertyOf(stateExpr, "category")?.initializer
    );
    const isTerminal = terminalStates.has(id) || category === "terminal";
    const autoTransitions = arrayOf(stateExpr, "autoTransitions") ?? [];
    const actions = arrayOf(stateExpr, "actions") ?? [];
    states.set(id, {
      hasExit: autoTransitions.length > 0 || actions.length > 0 || isTerminal,
    });
    for (const item of autoTransitions) {
      if (!ts.isObjectLiteralExpression(item)) continue;
      transitions.push({
        from: id,
        to: stringValue(propertyOf(item, "to")?.initializer),
        gate: propertyOf(item, "gate")?.initializer,
      });
    }
    for (const item of actions) {
      if (!ts.isObjectLiteralExpression(item)) continue;
      transitions.push({
        from: id,
        to: stringValue(propertyOf(item, "transitionTo")?.initializer),
        gate: propertyOf(item, "gate")?.initializer,
      });
    }
  }

  // Edge-level reachability: BFS from initial following transition targets.
  // Gates are not evaluated — a state with an edge into it counts as
  // reachable even if every such edge is gated (conservative lower bound).
  const reachable = new Set<string>();
  if (initial !== undefined) {
    reachable.add(initial);
    const queue = [initial];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const transition of transitions) {
        if (
          transition.from !== current ||
          transition.to === undefined ||
          reachable.has(transition.to)
        ) {
          continue;
        }
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  for (const id of states.keys()) {
    if (id === initial) continue;
    if (!reachable.has(id)) {
      warnings.push(
        `[${workflowId}] state "${id}" is unreachable — no transition targets it from a reachable state`
      );
    }
  }
  for (const [id, info] of states) {
    if (!terminalStates.has(id) && !info.hasExit) {
      warnings.push(
        `[${workflowId}] state "${id}" has no way out (no autoTransitions, no actions, not terminal) — instances reaching it are stuck`
      );
    }
  }
  for (const transition of transitions) {
    if (transition.to === undefined) continue;
    if (!states.has(transition.to)) {
      warnings.push(
        `[${workflowId}] transition from "${transition.from}" targets unknown state "${transition.to}"`
      );
      continue;
    }
    if (transition.gate !== undefined && isNeverGate(transition.gate)) {
      warnings.push(
        `[${workflowId}] transition "${transition.from}" → "${transition.to}" is gated never — it can never fire`
      );
    }
  }

  return warnings;
}

export function isNeverGate(gate: ts.Expression): boolean {
  const expr = unwrap(gate);
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isArrowFunction(expr) && !ts.isBlock(expr.body)) {
    return unwrap(expr.body).kind === ts.SyntaxKind.FalseKeyword;
  }
  return false;
}

// ─── per-workflow contract ─────────────────────────────────────────────
