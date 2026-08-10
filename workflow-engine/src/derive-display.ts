import type { DerivedDisplay } from "./workflow-types";

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
