import { type EdgeEffect, evaluateEdges } from "./evaluate-edges";
import { reduce, type WorkflowEvent } from "./reduce";
import type { WorkflowItemState } from "./shared/workflow-item-state";
import type { FlowEdge, StateDef } from "./workflow-types";

export type RuntimeItem = {
  workflowId: string;
  itemId: string;
  state: WorkflowItemState<Record<string, unknown>, string>;
};

export function createWorkflowRuntime() {
  const items = new Map<string, RuntimeItem>();

  function key(workflowId: string, itemId: string): string {
    return `${workflowId}\0${itemId}`;
  }

  function addItem(
    workflowId: string,
    itemId: string,
    initialState: WorkflowItemState<Record<string, unknown>, string>
  ): void {
    items.set(key(workflowId, itemId), {
      workflowId,
      itemId,
      state: initialState,
    });
  }

  function getItem(
    workflowId: string,
    itemId: string
  ): RuntimeItem | undefined {
    return items.get(key(workflowId, itemId));
  }

  function getAllItems(): RuntimeItem[] {
    return Array.from(items.values());
  }

  function onEvent(
    workflowId: string,
    itemId: string,
    event: WorkflowEvent<Record<string, unknown>, string>,
    states: readonly StateDef<Record<string, unknown>, string>[],
    edges: FlowEdge[]
  ): EdgeEffect[] {
    const entry = getItem(workflowId, itemId);
    if (!entry) return [];

    const result = reduce(entry.state, event, states);
    entry.state = result.state;

    const effects = evaluateEdges(
      edges,
      workflowId,
      entry.state.currentState,
      entry.state.taskOutputs
    );

    if (result.commands.some((c) => c.type === "start_auto_tasks")) {
      const stateDef = states.find((s) => s.id === entry.state.currentState);
      if (stateDef) {
        const autoTasks = stateDef.tasks?.filter((t) => t.trigger === "auto");
        if (autoTasks?.length) {
          entry.state = {
            ...entry.state,
            hasRunningTask: true,
            runningTaskId: autoTasks[0]!.id,
          };
        }
      }
    }

    return effects;
  }

  return { addItem, getItem, getAllItems, onEvent };
}
