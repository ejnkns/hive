import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { VisibleAction } from "workflow-engine/workflow-types";

// Shared fixture builders for rendering-surface component tests. The shapes
// mirror the wire contract (WorkflowDefResponse / WorkflowInstanceEntry).

export function cardDef(
  overrides: Partial<WorkflowDefResponse> = {}
): WorkflowDefResponse {
  return {
    id: "cards",
    label: "Cards",
    instance: { title: "cardSpec.title" },
    states: [
      {
        id: "ready",
        label: "Ready",
        category: "initial",
        actions: [],
        tasks: [],
      },
      {
        id: "in_progress",
        label: "In Progress",
        category: "active",
        actions: [],
        tasks: [],
      },
      {
        id: "done",
        label: "Done",
        category: "terminal",
        actions: [],
        tasks: [],
      },
    ],
    initial: "ready",
    terminalStates: ["done"],
    ...overrides,
  };
}

export function boardDef(
  columns: Array<{ id: string; label: string; states: string[] }>
): WorkflowDefResponse {
  return cardDef({ ui: { view: "board", columns } });
}

export function entry(
  id: string,
  currentState: string,
  overrides: Partial<WorkflowInstanceEntry["state"]> = {}
): WorkflowInstanceEntry {
  return {
    id,
    workflowId: "cards",
    state: {
      currentState,
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      taskOutputs: {},
      workflowInstanceState: { cardSpec: { title: `Card ${id}` } },
      history: [],
      ...overrides,
    },
    availableActions: [],
    dependencies: { blockers: [], unsatisfied: [] },
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

export function action(
  id: string,
  label: string,
  variant: VisibleAction["variant"] = "primary"
): VisibleAction {
  return { id, label, variant };
}
