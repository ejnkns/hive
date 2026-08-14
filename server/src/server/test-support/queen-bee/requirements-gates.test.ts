import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAvailableActions } from "workflow-engine/get-available-actions";
import type { RuntimeWorkflowInstanceState } from "workflow-engine/shared/workflow-instance-state";
import { queenBeeWorkflows } from "../compiled-presets.ts";

// The requirements workflow, extracted from the rendered definition (the old
// requirements-workflow.ts module was absorbed into the blueprint).
const requirementsWorkflow = (() => {
  const workflow = queenBeeWorkflows.find((wf) => wf.id === "requirements");
  if (workflow === undefined) {
    throw new Error("requirements workflow not found");
  }
  return workflow;
})();

function planningState(
  overrides: Partial<RuntimeWorkflowInstanceState>
): RuntimeWorkflowInstanceState {
  return {
    currentState: "planning",
    taskOutputs: {},
    hasRunningTask: false,
    runningTaskId: null,
    runningTaskContext: null,
    workflowInstanceState: {},
    history: [],
    ...overrides,
  };
}

function plannedProposalState(
  hasRunningTask: boolean
): RuntimeWorkflowInstanceState {
  return planningState({
    taskOutputs: {
      plan: {
        status: "success",
        output: { kind: "proposal", cards: [{ title: "Card 1" }] },
      },
    },
    hasRunningTask,
    runningTaskId: hasRunningTask ? "plan" : null,
  });
}

describe("requirements workflow planning gates", () => {
  const states = requirementsWorkflow.states;

  it("hides accept_proposal while the planner is running", () => {
    const actions = getAvailableActions(
      states,
      "planning",
      plannedProposalState(true)
    );
    assert.ok(
      !actions.some((action) => action.id === "accept_proposal"),
      "accept_proposal must not be available while the planner runs"
    );
  });

  it("shows accept_proposal once a proposal is ready and no task is running", () => {
    const actions = getAvailableActions(
      states,
      "planning",
      plannedProposalState(false)
    );
    assert.ok(
      actions.some((action) => action.id === "accept_proposal"),
      "accept_proposal should be available after a settled proposal"
    );
  });

  it("shows repair for a feedback plan and hides accept_proposal", () => {
    const state = planningState({
      taskOutputs: {
        plan: {
          status: "success",
          output: { kind: "feedback", guidance: "revise" },
        },
      },
    });
    const actions = getAvailableActions(states, "planning", state);
    assert.ok(actions.some((action) => action.id === "repair"));
    assert.ok(!actions.some((action) => action.id === "accept_proposal"));
  });

  it("hides submit-for-planning when no requirements document is recorded", () => {
    const state = planningState({
      currentState: "complete",
      taskOutputs: { draft: { status: "success", output: undefined } },
    });
    const actions = getAvailableActions(states, "complete", state);
    assert.ok(
      !actions.some((action) => action.id === "approve"),
      "planning must not start without a requirements document"
    );
  });

  it("shows submit-for-planning once a requirements draft is recorded", () => {
    const state = planningState({
      currentState: "complete",
      workflowInstanceState: { requirementsDraft: "# Requirements" },
    });
    const actions = getAvailableActions(states, "complete", state);
    assert.ok(
      actions.some((action) => action.id === "approve"),
      "planning should be reachable once the draft is recorded"
    );
  });
});
