/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state.ts";
import type {
  ActionVariant,
  BoardColumn,
  ConfigField,
  DisplayHint,
  RuntimeRenderHint,
  StateCategory,
  VisibleAction,
  WorkflowSummary,
  WorkflowView,
} from "../workflow-types.ts";

// The serialized workflow-definition shape the UI receives: states with their
// actions and per-task render hints, plus the workflow's rendering hints.
export type WorkflowDefResponse = {
  id: string;
  label: string;
  description?: string;
  // The workflow-instance header hint (dotted paths into instance state).
  instance?: { title: string; subtitle?: string };
  // The workflow-instance body hint (curated workflowInstanceState fields).
  display?: DisplayHint;
  // Per-workflow rendering hooks (e.g. a custom instance component id, a
  // workflow-level custom view, the layout view, and optional curated board
  // columns / field grouping).
  ui?: {
    instanceComponent?: string;
    workflowComponent?: string;
    view?: WorkflowView;
    columns?: readonly BoardColumn[];
    // E3: board grouping by the distinct values of a declared instance-state
    // field (one column per value + uncategorized). Generic partition.
    groupByField?: string;
  };
  states: Array<{
    id: string;
    label: string;
    description?: string;
    category?: StateCategory;
    actions: Array<{ id: string; label: string; variant: ActionVariant }>;
    // Serialized task entries: the UI correlates completed task outputs by id
    // and applies the per-task render hint. `role` rides on the wire so the
    // generic card renderer can apply role-based defaults (operation outputs
    // are hidden unless a render hint overrides).
    tasks?: Array<{
      id: string;
      label: string;
      role: "operation" | "ai-task" | "ai-chat";
      render?: RuntimeRenderHint;
    }>;
  }>;
  initial: string;
  terminalStates: string[];
};

export type WorkflowInstanceEntry = {
  id: string;
  workflowId: string;
  state: RuntimeWorkflowInstanceState;
  availableActions: VisibleAction[];
  // The workflow's declared editable instance-state fields; the UI renders an
  // "Edit details" form from these and patches instance state through the
  // state API. Empty/absent when the workflow is not editable.
  editFields: ConfigField[];
  // Server-computed aggregate over the workflow's instances (total + per
  // field-value counts); the card evaluates countAcross / progressAcross
  // derives against it.
  workflowSummary: WorkflowSummary;
};
