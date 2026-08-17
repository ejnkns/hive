/** @private — only imported by workflow-instances.ts */

// The flow-level overview derivation: aggregates across a flow's workflows
// (instance counts, running work, actionable instances, error/terminal) from
// the same snapshot the boards render — a derived view, no server involvement.

export type OverviewStatus =
  | "error"
  | "running"
  | "waiting"
  | "complete"
  | "idle";

export type WorkflowOverview = {
  workflowId: string;
  label: string;
  total: number;
  running: number; // active non-chat tasks
  waiting: number; // active ai-chat sessions awaiting input
  error: number; // instances in a category-"error" state
  terminal: number; // instances in the workflow's terminal states
  actionable: number; // instances with available actions (awaiting a user click)
  status: OverviewStatus;
};

export type FlowOverview = {
  totals: {
    instances: number;
    running: number;
    waiting: number;
    error: number;
    terminal: number;
    actionable: number;
  };
  byWorkflow: WorkflowOverview[];
};

// The structural slice of the wire shapes the derivation reads; the real
// WorkflowDefResponse / WorkflowInstanceEntry satisfy it. Exported so tests
// construct minimal fixtures.
export type OverviewDef = {
  id: string;
  label: string;
  states: readonly { id: string; category?: string }[];
  terminalStates: readonly string[];
};

export type OverviewEntry = {
  workflowId: string;
  state: {
    currentState: string;
    hasRunningTask: boolean;
    runningTaskContext: { role: string } | null;
  };
  availableActions: readonly unknown[];
};

export function computeFlowOverview(
  workflowDefs: readonly OverviewDef[],
  instances: readonly OverviewEntry[]
): FlowOverview {
  const entriesByWorkflow = new Map<string, OverviewEntry[]>();
  for (const entry of instances) {
    const list = entriesByWorkflow.get(entry.workflowId) ?? [];
    list.push(entry);
    entriesByWorkflow.set(entry.workflowId, list);
  }

  const byWorkflow = workflowDefs.map((def) =>
    overviewForWorkflow(def, entriesByWorkflow.get(def.id) ?? [])
  );

  const totals = {
    instances: 0,
    running: 0,
    waiting: 0,
    error: 0,
    terminal: 0,
    actionable: 0,
  };
  for (const workflow of byWorkflow) {
    totals.instances += workflow.total;
    totals.running += workflow.running;
    totals.waiting += workflow.waiting;
    totals.error += workflow.error;
    totals.terminal += workflow.terminal;
    totals.actionable += workflow.actionable;
  }
  return { totals, byWorkflow };
}

function overviewForWorkflow(
  def: OverviewDef,
  entries: readonly OverviewEntry[]
): WorkflowOverview {
  const errorStates = new Set(
    def.states
      .filter((state) => state.category === "error")
      .map((state) => state.id)
  );
  const terminalStates = new Set(def.terminalStates);

  let running = 0;
  let waiting = 0;
  let error = 0;
  let terminal = 0;
  let actionable = 0;
  for (const entry of entries) {
    if (entry.state.hasRunningTask) {
      if (entry.state.runningTaskContext?.role === "ai-chat") waiting++;
      else running++;
    }
    if (errorStates.has(entry.state.currentState)) error++;
    if (terminalStates.has(entry.state.currentState)) terminal++;
    if (entry.availableActions.length > 0) actionable++;
  }

  // Mirrors the server's computeInstanceStatus precedence (instance-status.ts).
  const status: OverviewStatus =
    error > 0
      ? "error"
      : running > 0
        ? "running"
        : waiting > 0
          ? "waiting"
          : entries.length > 0 && terminal === entries.length
            ? "complete"
            : "idle";

  return {
    workflowId: def.id,
    label: def.label,
    total: entries.length,
    running,
    waiting,
    error,
    terminal,
    actionable,
    status,
  };
}
