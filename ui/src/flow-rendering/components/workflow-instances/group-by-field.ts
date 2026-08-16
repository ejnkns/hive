/** @private — only imported by workflow-instances.ts */

import { resolvePath } from "../../resolve-path.ts";

// The structural column shape (declared locally — group-by-columns.ts is a
// private module owned by workflow-instances.ts, so this partition defines its
// own compatible shape).
export type FieldColumn<TEntry> = {
  id: string;
  label: string;
  category: string;
  entries: TEntry[];
};

// Groups a workflow's instances by the distinct values of a declared
// instance-state field (E3): one column per distinct value, plus an
// "uncategorized" column for instances where the field is absent/empty. This
// is a GENERIC partition — the values are opaque data, never interpreted:
// no labels, no ordering, no semantics (a column id and label are both the
// raw value). Columns appear in first-seen order of their value; the
// uncategorized column trails last. When every instance has the field, the
// uncategorized column still renders if a value bucket is empty? No — it
// renders only when at least one instance lacks the value (a fully-populated
// board has no uncategorized lane). An empty board renders a single empty
// uncategorized column so the workflow stays visible.
export function groupInstancesByField<
  TEntry extends {
    state: {
      currentState: string;
      workflowInstanceState: Record<string, unknown>;
    };
  },
>(field: string, entries: readonly TEntry[]): FieldColumn<TEntry>[] {
  const byValue = new Map<string, TEntry[]>();
  const uncategorized: TEntry[] = [];

  for (const entry of entries) {
    const value = resolvePath(
      entry.state.workflowInstanceState as Record<string, unknown>,
      field
    );
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    ) {
      uncategorized.push(entry);
      continue;
    }
    // Scalar values group directly; arrays are opaque — group by their JSON
    // serialization so a tags[] bucket is stable (the UI never interprets the
    // values, it only partitions them).
    const key =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    const list = byValue.get(key) ?? [];
    list.push(entry);
    byValue.set(key, list);
  }

  const columns: FieldColumn<TEntry>[] = [];
  for (const [key, bucket] of byValue) {
    columns.push({ id: key, label: key, category: "active", entries: bucket });
  }
  if (uncategorized.length > 0 || columns.length === 0) {
    columns.push({
      id: "uncategorized",
      label: "Uncategorized",
      category: "active",
      entries: uncategorized,
    });
  }
  return columns;
}
