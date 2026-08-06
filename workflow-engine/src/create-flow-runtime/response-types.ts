/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state";
import type {
  ActionVariant,
  BoardColumn,
  DisplayHint,
  RuntimeRenderHint,
  StateCategory,
  VisibleAction,
  WorkflowView,
} from "../workflow-types";

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
  // Per-workflow rendering hooks (e.g. a custom instance component id, the
  // layout view, and optional curated board columns).
  ui?: {
    instanceComponent?: string;
    view?: WorkflowView;
    columns?: readonly BoardColumn[];
  };
  states: Array<{
    id: string;
    label: string;
    description?: string;
    category?: StateCategory;
    actions: Array<{ id: string; label: string; variant: ActionVariant }>;
    // Serialized task entries: the UI correlates completed task outputs by id
    // and applies the per-task render hint.
    tasks?: Array<{ id: string; label: string; render?: RuntimeRenderHint }>;
  }>;
  initial: string;
  terminalStates: string[];
};

export type WorkflowInstanceEntry = {
  id: string;
  workflowId: string;
  state: RuntimeWorkflowInstanceState;
  availableActions: VisibleAction[];
};
