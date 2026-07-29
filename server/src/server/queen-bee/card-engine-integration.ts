import type { Card } from "shared/board-types";
import { reduce, type WorkflowEvent } from "workflow-engine/reduce";
import type { WorkflowItemState } from "workflow-engine/shared/workflow-item-state";
import type { CardsStateId, CardsTaskOutputs } from "./cards-workflow";
import { cardsWorkflow } from "./cards-workflow";

// === Parallel Engine Integration ===
//
// Drives the workflow reducer alongside the existing imperative card
// lifecycle code. After each mutation to the real card, the equivalent
// event is dispatched to the reducer so its state stays in sync.
// Disagreements between the two are logged.

const instances = new Map<
  string,
  WorkflowItemState<CardsTaskOutputs, CardsStateId>
>();

function log(event: string, args: Record<string, unknown>): void {
  console.log(`[card-engine] ${event}`, args);
}

function getOrCreate(
  card: Card
): WorkflowItemState<CardsTaskOutputs, CardsStateId> {
  let state = instances.get(card.id);
  if (!state) {
    state = {
      currentState: "ready",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };
    instances.set(card.id, state);
  }
  return state;
}

function compare(
  card: Card,
  state: WorkflowItemState<CardsTaskOutputs, CardsStateId>
): void {
  if (card.column !== state.currentState) {
    log("state_mismatch", {
      cardId: card.id,
      cardColumn: card.column,
      engineState: state.currentState,
      hasRunningTask: state.hasRunningTask,
      taskOutputs: Object.keys(state.taskOutputs),
    });
  }
}

function sync(
  card: Card,
  event: WorkflowEvent<CardsTaskOutputs, CardsStateId>,
  label: string
): void {
  const state = getOrCreate(card);
  const { state: newState } = reduce(state, event, cardsWorkflow.states);
  instances.set(card.id, newState);
  compare(card, newState);
  log("engine_synced", {
    cardId: card.id,
    event: label,
    engineState: newState.currentState,
  });
}

// === Lifecycle event handlers ===

export function onCardCreated(card: Card): void {
  getOrCreate(card);
  log("engine_ready", { cardId: card.id });
}

export function onWorkerStarted(card: Card): void {
  sync(
    card,
    {
      type: "action_triggered",
      actionId: "run",
      transitionTo: "in_progress",
    },
    "worker_started"
  );
}

export function onWorkerCompleted(card: Card): void {
  sync(
    card,
    {
      type: "task_completed",
      taskId: "implement",
      output: {},
    },
    "worker_completed"
  );
}

export function onWorkerErrored(card: Card, error: string): void {
  sync(
    card,
    {
      type: "task_errored",
      taskId: "implement",
      error,
    },
    "worker_errored"
  );
}

export function onCancelled(card: Card): void {
  const state = getOrCreate(card);
  const { state: newState } = reduce(
    { ...state, hasRunningTask: true, runningTaskId: "implement" },
    { type: "task_cancelled", taskId: "implement" },
    cardsWorkflow.states
  );
  instances.set(card.id, newState);
  compare(card, newState);
  log("engine_synced", {
    cardId: card.id,
    event: "cancelled",
    engineState: newState.currentState,
  });
}

export function onReviewCompleted(card: Card, verdict: string): void {
  sync(
    card,
    {
      type: "task_completed",
      taskId: "review",
      output: { verdict },
    },
    "review_completed"
  );
}

export function onReviewErrored(card: Card, error: string): void {
  sync(
    card,
    {
      type: "task_errored",
      taskId: "review",
      error,
    },
    "review_errored"
  );
}

export function onAccepted(card: Card): void {
  sync(
    card,
    {
      type: "action_triggered",
      actionId: "accept",
      transitionTo: "done",
    },
    "accepted"
  );
}

export function onUpdateChanges(card: Card): void {
  sync(
    card,
    {
      type: "action_triggered",
      actionId: "update_changes",
      transitionTo: "in_progress",
    },
    "update_changes"
  );
}

export function onNewChanges(card: Card): void {
  sync(
    card,
    {
      type: "action_triggered",
      actionId: "new_changes",
      transitionTo: "ready",
    },
    "new_changes"
  );
}

export function getEngineState(
  cardId: string
): WorkflowItemState<CardsTaskOutputs, CardsStateId> | undefined {
  return instances.get(cardId);
}
