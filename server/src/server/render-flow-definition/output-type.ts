/** @private — the derived per-task output type the renderer emits from the
 * taskOutputEquals paths gates reference. */

import type { FlowSpec, GateSpec } from "../flow-spec";

type OutputNode = {
  leaf?: string;
  children?: Map<string, OutputNode>;
};

// Collect every taskOutputEquals reference per task: the path relative to the
// task's output ("" = the whole output) and the comparison value's type.
// Mirrors the validation that keeps paths prefix-consistent.
export function collectOutputPaths(
  spec: FlowSpec
): Map<string, { rest: string; type: string }[]> {
  const byTask = new Map<string, { rest: string; type: string }[]>();
  const visitGate = (gate: GateSpec) => {
    if (gate.kind === "taskOutputEquals") {
      const rest =
        gate.path === "output" ? "" : gate.path.slice("output.".length);
      const list = byTask.get(gate.task) ?? [];
      list.push({ rest, type: typeof gate.value });
      byTask.set(gate.task, list);
    } else if (gate.kind === "not") {
      visitGate(gate.gate);
    } else if (gate.kind === "and" || gate.kind === "or") {
      for (const g of gate.gates) visitGate(g);
    }
  };
  for (const wf of spec.workflows) {
    for (const state of wf.states) {
      for (const transition of state.autoTransitions ?? [])
        visitGate(transition.gate);
      for (const action of state.actions ?? [])
        if (action.gate) visitGate(action.gate);
    }
  }
  return byTask;
}

export function buildOutputNode(
  paths: { rest: string; type: string }[]
): OutputNode {
  const root: OutputNode = { children: new Map() };
  let rootLeaf: string | undefined;
  for (const { rest, type } of paths) {
    if (rest === "") {
      rootLeaf = rootLeaf ? unionType(rootLeaf, type) : type;
      continue;
    }
    let current = root;
    const segments = rest.split(".");
    for (let i = 0; i < segments.length - 1; i++) {
      const children = current.children ?? new Map();
      let next = children.get(segments[i]);
      if (!next) {
        next = { children: new Map() };
        children.set(segments[i], next);
        current.children = children;
      }
      current = next;
    }
    const children = current.children ?? new Map();
    const last = segments[segments.length - 1];
    const existing = children.get(last);
    if (existing) {
      existing.leaf = existing.leaf ? unionType(existing.leaf, type) : type;
    } else {
      children.set(last, { leaf: type });
    }
    current.children = children;
  }
  if (rootLeaf !== undefined) return { leaf: rootLeaf };
  return root;
}

export function unionType(a: string, b: string): string {
  const parts = [...new Set([a, b].flatMap((t) => t.split(" | ")))];
  return parts.sort().join(" | ");
}

export function renderOutputNode(node: OutputNode): string {
  if (node.leaf !== undefined) return node.leaf;
  const parts = [...(node.children ?? new Map()).entries()].map(
    ([segment, child]) => `${segment}?: ${renderOutputNode(child)}`
  );
  return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
}

// ─── value rendering (patch ops / edge transforms) ────────────────────
