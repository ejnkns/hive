/** @public — server-computed per-flow instance status. Pure derivation from workflow definitions + instance entries. */

import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";

export type InstanceStatus =
  | "error"
  | "running"
  | "waiting"
  | "idle"
  | "complete";

// Single status per flow, derived in precedence order:
//   1. error    — any instance in a state with category "error"
//   2. running  — any instance with an active non-ai-chat task (operation/ai-task)
//   3. waiting  — any instance with an active ai-chat session awaiting input
//   4. idle     — otherwise, when not every instance is terminal
//   5. complete — every instance is in a terminal state
export function computeInstanceStatus(
  workflows: WorkflowDefResponse[],
  instances: WorkflowInstanceEntry[]
): InstanceStatus {
  if (instances.length === 0) return "idle";

  const errorStates = new Set<string>();
  const terminalStates = new Map<string, Set<string>>();
  for (const workflow of workflows) {
    for (const state of workflow.states) {
      if (state.category === "error") errorStates.add(state.id);
    }
    terminalStates.set(workflow.id, new Set(workflow.terminalStates));
  }

  if (instances.some((entry) => errorStates.has(entry.state.currentState))) {
    return "error";
  }

  if (
    instances.some(
      (entry) =>
        entry.state.hasRunningTask &&
        entry.state.runningTaskContext?.role !== "ai-chat"
    )
  ) {
    return "running";
  }

  if (instances.some((entry) => entry.state.hasRunningTask)) {
    return "waiting";
  }

  const allTerminal = instances.every((entry) =>
    terminalStates.get(entry.workflowId)?.has(entry.state.currentState)
  );
  return allTerminal ? "complete" : "idle";
}
