import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowEdge } from "workflow-engine/workflow-types";
import { createItem, onItemEvent, type WorkflowItems } from "./flow-store";
import { queenBeeFlow } from "./queen-bee-flows";

function emptyItems(): WorkflowItems {
  return {
    cards: new Map(),
    ideas: new Map(),
    requirements: new Map(),
  };
}

describe("flow-store", () => {
  it("creates items with initial state", () => {
    const items = emptyItems();
    createItem(items, "cards", "card-1");
    createItem(items, "ideas", "idea-1");
    createItem(items, "requirements", "req-1");

    assert.equal(items.cards.get("card-1")?.currentState, "ready");
    assert.equal(items.ideas.get("idea-1")?.currentState, "backlog");
    assert.equal(items.requirements.get("req-1")?.currentState, "no_session");
  });

  it("processes events and transitions state", () => {
    const items = emptyItems();
    createItem(items, "cards", "card-1");

    const effects = onItemEvent(items, queenBeeFlow.edges, "cards", "card-1", {
      type: "action_triggered",
      actionId: "run",
      transitionTo: "in_progress",
    });

    assert.equal(items.cards.get("card-1")?.currentState, "in_progress");
  });

  it("activates ideas → requirements edge when idea reaches submitted", () => {
    const items = emptyItems();
    createItem(items, "ideas", "idea-1");

    // Start elaboration → elaborating
    onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "action_triggered",
      actionId: "elaborate",
      transitionTo: "elaborating",
    });
    assert.equal(items.ideas.get("idea-1")?.currentState, "elaborating");

    // Elaboration task completes → refined (auto-transition)
    onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "task_completed",
      taskId: "elaborate",
      output: { ideaBrief: "Test", elaboratedSpec: "Spec" },
    });
    assert.equal(items.ideas.get("idea-1")?.currentState, "refined");

    // Approve the idea → submitted
    const effects = onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "action_triggered",
      actionId: "approve",
      transitionTo: "submitted",
    });

    // Edge should fire for ideas/submitted → requirements
    assert.equal(effects.length, 1);
    assert.equal(effects[0]!.fromWorkflow, "ideas");
    assert.equal(effects[0]!.toWorkflow, "requirements");
  });

  it("activates requirements → cards edge when requirements reaches accepted", () => {
    const items = emptyItems();
    createItem(items, "requirements", "req-1");

    // Start → drafting
    onItemEvent(items, queenBeeFlow.edges, "requirements", "req-1", {
      type: "action_triggered",
      actionId: "start",
      transitionTo: "drafting",
    });

    // Drafting → complete (auto-transition)
    onItemEvent(items, queenBeeFlow.edges, "requirements", "req-1", {
      type: "task_completed",
      taskId: "draft",
      output: { content: "Requirements doc", revision: "v1" },
    });

    // Complete → planning
    onItemEvent(items, queenBeeFlow.edges, "requirements", "req-1", {
      type: "action_triggered",
      actionId: "approve",
      transitionTo: "planning",
    });

    // Planning → planned (auto-transition task_completed + accept_proposal)
    onItemEvent(items, queenBeeFlow.edges, "requirements", "req-1", {
      type: "task_completed",
      taskId: "plan",
      output: { kind: "proposal" },
    });

    // Planned → accepted (accept_all)
    const effects = onItemEvent(
      items,
      queenBeeFlow.edges,
      "requirements",
      "req-1",
      {
        type: "action_triggered",
        actionId: "accept_all",
        transitionTo: "accepted",
      }
    );

    assert.equal(items.requirements.get("req-1")?.currentState, "accepted");
    assert.equal(effects.length, 1);
    assert.equal(effects[0]!.fromWorkflow, "requirements");
    assert.equal(effects[0]!.toWorkflow, "cards");
  });

  it("edge transform provides task output data", () => {
    const items = emptyItems();
    createItem(items, "ideas", "idea-1");

    // Start elaboration → elaborating
    onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "action_triggered",
      actionId: "elaborate",
      transitionTo: "elaborating",
    });

    // Complete elaboration → refined (auto-transition)
    onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "task_completed",
      taskId: "elaborate",
      output: { ideaBrief: "My idea", elaboratedSpec: "My spec" },
    });

    // Approve → submitted
    const effects = onItemEvent(items, queenBeeFlow.edges, "ideas", "idea-1", {
      type: "action_triggered",
      actionId: "approve",
      transitionTo: "submitted",
    });

    // The transform should have the elaborate output available
    const data = effects[0]!.transformedData as any;
    assert.ok(data.mergeDraft);
    assert.equal(data.triggerPlanning, true);
  });

  it("does not activate edge for non-terminal state", () => {
    const items = emptyItems();
    createItem(items, "cards", "card-1");

    const effects = onItemEvent(items, queenBeeFlow.edges, "cards", "card-1", {
      type: "action_triggered",
      actionId: "run",
      transitionTo: "in_progress",
    });

    // No edges match "in_progress" state for cards
    assert.equal(effects.length, 0);
  });
});
