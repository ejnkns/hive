/** @private — derived display specs, the workflow summary, and the display
 * hint. */

import type { PropPath, RuntimeRenderHint } from "./render-hints.ts";

export type DerivedDisplay =
  // Array length, optionally counting only items whose declared field equals
  // a value ("N pending").
  | {
      kind: "count";
      where?: { field: string; equals: string | number | boolean };
    }
  // "N of M": matching items over the array length ("3 of 5 done").
  | {
      kind: "progress";
      where: { field: string; equals: string | number | boolean };
    }
  // Running total over an array of numbers, or over a numeric item field.
  | { kind: "sum"; field?: string }
  // Across instances: count instances whose state[path] equals a value
  // (absent equals → all instances).
  | { kind: "countAcross"; equals?: string | number | boolean }
  // Across instances: matching instances over the workflow total ("2 of 5
  // instances in review").
  | { kind: "progressAcross"; equals: string | number | boolean };

// A server-computed aggregate over a workflow's instances, attached to every
// WorkflowInstanceEntry: the instance total plus per top-level scalar
// instance-state field value counts. The card evaluates countAcross /
// progressAcross derives against it.
export type WorkflowSummary = {
  total: number;
  byField: Record<string, Record<string, number>>;
};

// The instance-state body hint: which workflowInstanceState fields the
// instance card shows. Each field's render props resolve against that field's
// value. Without a display hint the raw state dump is shown.
export type DisplayField<
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  path: PropPath<TWorkflowInstanceState>;
  label?: string;
  render?: RuntimeRenderHint;
  // When present, the resolved path value is run through the derived display
  // (count/progress/sum) before rendering. A derive that cannot evaluate
  // (non-array source, missing item field) falls back to the raw value.
  derive?: DerivedDisplay;
};

export type DisplayHint<
  TWorkflowInstanceState extends Record<string, unknown> = Record<
    string,
    unknown
  >,
> = {
  fields: readonly DisplayField<TWorkflowInstanceState>[];
};
