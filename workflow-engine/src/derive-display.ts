import type { DerivedDisplay, WorkflowSummary } from "./workflow-types.ts";

// Evaluates a DerivedDisplay against a resolved display-field value. Pure and
// deterministic — the same module runs in the engine tests and the UI card,
// so a derived display computes identically everywhere. A derive that cannot
// evaluate (the source is not an array, an item lacks the declared field, a
// sum item is not numeric) returns undefined and the caller falls back to
// rendering the raw value.

export type DerivedDisplayResult =
  | { kind: "count"; value: number }
  | { kind: "sum"; value: number }
  | { kind: "progress"; count: number; total: number };

// Matches an array item against a where clause: the item's declared field
// strictly equals the expected value. Items that are not objects or lack the
// field never match (so "3 of 5 done" counts only explicit matches).
function matches(
  item: unknown,
  where: { field: string; equals: string | number | boolean }
): boolean {
  if (item === null || typeof item !== "object") return false;
  return (item as Record<string, unknown>)[where.field] === where.equals;
}

// Computes the per-workflow aggregate attached to every WorkflowInstanceEntry:
// the instance total plus counts per top-level scalar instance-state field
// value. Arrays/objects are skipped (they are per-instance data); only
// string/number/boolean fields aggregate meaningfully across instances.
export function summarizeWorkflowInstances(
  instances: Array<{ workflowInstanceState: Record<string, unknown> }>
): WorkflowSummary {
  const summary: WorkflowSummary = { total: instances.length, byField: {} };
  for (const instance of instances) {
    for (const [key, value] of Object.entries(instance.workflowInstanceState)) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        continue;
      }
      let byValue = summary.byField[key];
      if (byValue === undefined) {
        byValue = {};
        summary.byField[key] = byValue;
      }
      byValue[String(value)] = (byValue[String(value)] ?? 0) + 1;
    }
  }
  return summary;
}

// Evaluates an across-instance derive (countAcross / progressAcross) against
// a workflow summary. `field` is the display field's path — the single
// instance-state field being counted. A missing field/value counts zero.
export function deriveAcrossDisplayValue(
  derive:
    | { kind: "countAcross"; equals?: string | number | boolean }
    | { kind: "progressAcross"; equals: string | number | boolean },
  field: string,
  summary: WorkflowSummary
): DerivedDisplayResult | undefined {
  if (derive.kind === "countAcross") {
    if (derive.equals === undefined) {
      return { kind: "count", value: summary.total };
    }
    const count = summary.byField[field]?.[String(derive.equals)] ?? 0;
    return { kind: "count", value: count };
  }
  const count = summary.byField[field]?.[String(derive.equals)] ?? 0;
  return { kind: "progress", count, total: summary.total };
}

export function deriveDisplayValue(
  derive: DerivedDisplay,
  value: unknown
): DerivedDisplayResult | undefined {
  if (!Array.isArray(value)) return undefined;

  switch (derive.kind) {
    case "count": {
      const where = derive.where;
      const total =
        where !== undefined
          ? value.filter((item) => matches(item, where)).length
          : value.length;
      return { kind: "count", value: total };
    }
    case "progress": {
      const count = value.filter((item) => matches(item, derive.where)).length;
      return { kind: "progress", count, total: value.length };
    }
    case "sum": {
      const field = derive.field;
      const items =
        field !== undefined
          ? value
              .filter((item) => item !== null && typeof item === "object")
              .map((item) => (item as Record<string, unknown>)[field])
          : value;
      const numbers = items.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item)
      );
      if (numbers.length === 0) return undefined;
      const total = numbers.reduce((acc, item) => acc + item, 0);
      return { kind: "sum", value: total };
    }
  }
}
