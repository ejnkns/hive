import { type EdgeEffect, evaluateEdges } from "workflow-engine/evaluate-edges";
import { reduce } from "workflow-engine/reduce";
import type { WorkflowItemState } from "workflow-engine/shared/workflow-item-state";
import type { FlowEdge, StateDef } from "workflow-engine/workflow-types";
import { cardsWorkflow } from "./cards-workflow";
import { ideasWorkflow } from "./ideas-workflow";
import { requirementsWorkflow } from "./requirements-workflow";

// === Flow Store ===
//
// Tracks workflow item state for all items across all queen-bee workflows.
// After each item state change, evaluates FlowDefinition edges and returns
// effects for cross-workflow coordination.

export type WorkflowItems = {
  cards: Map<string, WorkflowItemState<Record<string, unknown>, string>>;
  ideas: Map<string, WorkflowItemState<Record<string, unknown>, string>>;
  requirements: Map<string, WorkflowItemState<Record<string, unknown>, string>>;
};

type AnyState = WorkflowItemState<Record<string, unknown>, string>;

function log(event: string, args: Record<string, unknown>): void {
  console.log(`[flow-store] ${event}`, args);
}

function findItem(
  items: WorkflowItems,
  workflowId: string,
  itemId: string
): AnyState | undefined {
  if (workflowId === "cards")
    return items.cards.get(itemId) as AnyState | undefined;
  if (workflowId === "ideas")
    return items.ideas.get(itemId) as AnyState | undefined;
  if (workflowId === "requirements")
    return items.requirements.get(itemId) as AnyState | undefined;
  return undefined;
}

function setItem(
  items: WorkflowItems,
  workflowId: string,
  itemId: string,
  state: AnyState
): void {
  if (workflowId === "cards") items.cards.set(itemId, state as any);
  else if (workflowId === "ideas") items.ideas.set(itemId, state as any);
  else if (workflowId === "requirements")
    items.requirements.set(itemId, state as any);
}

function findStates(workflowId: string): readonly StateDef<any, any>[] {
  if (workflowId === "cards") return cardsWorkflow.states;
  if (workflowId === "ideas") return ideasWorkflow.states;
  if (workflowId === "requirements") return requirementsWorkflow.states;
  return [];
}

// Process a state change event for an item. Returns edge effects.
export function onItemEvent(
  items: WorkflowItems,
  edges: FlowEdge[],
  workflowId: string,
  itemId: string,
  event: any
): EdgeEffect[] {
  const state = findItem(items, workflowId, itemId);
  if (!state) return [];

  const states = findStates(workflowId);
  const { state: newState } = reduce(state, event, states as any);
  setItem(items, workflowId, itemId, newState);

  log("state_changed", {
    workflowId,
    itemId,
    from: state.currentState,
    to: newState.currentState,
  });

  const effects = evaluateEdges(
    edges,
    workflowId,
    newState.currentState,
    newState.taskOutputs as Record<string, unknown>
  );

  for (const effect of effects) {
    log("edge_activated", {
      fromWorkflow: effect.fromWorkflow,
      toWorkflow: effect.toWorkflow,
      fromState: effect.fromState,
      transformedData: effect.transformedData,
    });
  }

  return effects;
}

// Create an initial item in the given workflow.
export function createItem(
  items: WorkflowItems,
  workflowId: string,
  itemId: string
): AnyState | undefined {
  let state: AnyState | undefined;

  if (workflowId === "cards") {
    state = {
      currentState: "ready",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    items.cards.set(itemId, state as any);
  } else if (workflowId === "ideas") {
    state = {
      currentState: "backlog",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    items.ideas.set(itemId, state as any);
  } else if (workflowId === "requirements") {
    state = {
      currentState: "no_session",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    items.requirements.set(itemId, state as any);
  }

  return state;
}
