import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAvailableActions } from "./get-available-actions";
import { reduce } from "./reduce";
import type { WorkflowInstanceState } from "./shared/workflow-instance-state";
import { defineWorkflow, type NoOutput } from "./workflow-types";

const cardsWorkflow = defineWorkflow({
  id: "cards",
  label: "Cards",
  taskOutputs: {
    implement: {} as NoOutput,
    review: {} as { verdict: "approved" | "changes_requested" },
    coordinate: {} as { summary: string },
  },
  states: [
    {
      id: "ready",
      label: "Ready",
      actions: [
        {
          id: "run",
          label: "Run Worker Agent",
          transitionTo: "in_progress",
        },
      ],
    },
    {
      id: "in_progress",
      label: "In Progress",
      tasks: [
        {
          id: "implement",
          label: "Implement",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "write_file", "run_command", "git_log"],
          systemPrompt: "You are a feature implementer...",
        },
      ],
      autoTransitions: [
        {
          to: "reviewing",
          gate: (ctx) => ctx.taskOutputs.implement?.status === "success",
        },
        {
          to: "ready",
          gate: (ctx) => ctx.taskOutputs.implement?.status === "error",
        },
      ],
      actions: [
        {
          id: "cancel",
          label: "Cancel",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "ready",
        },
      ],
    },
    {
      id: "reviewing",
      label: "Reviewing",
      tasks: [
        {
          id: "review",
          label: "Review work",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code", "git_log"],
          systemPrompt: "You are a code reviewer...",
        },
      ],
      actions: [
        {
          id: "accept",
          label: "Accept work",
          gate: (ctx) => ctx.taskOutputs.review?.output?.verdict === "approved",
          transitionTo: "done",
        },
        {
          id: "accept_anyway",
          label: "Accept anyway",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          transitionTo: "done",
        },
        {
          id: "update_changes",
          label: "Update work",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          transitionTo: "in_progress",
        },
        {
          id: "new_changes",
          label: "New attempt",
          gate: (ctx) =>
            ctx.taskOutputs.review?.output?.verdict === "changes_requested",
          transitionTo: "ready",
        },
        {
          id: "restart_review",
          label: "Retry review",
          gate: (ctx) => ctx.taskOutputs.review?.status === "error",
          transitionTo: "reviewing",
        },
      ],
    },
    { id: "done", label: "Done" },
    {
      id: "unfulfillable",
      label: "Unfulfillable",
      tasks: [
        {
          id: "coordinate",
          label: "Analyze handover",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file", "search_code"],
          systemPrompt: "You are a coordinator...",
        },
      ],
      actions: [
        {
          id: "remediate",
          label: "Apply remediation",
          gate: (ctx) => ctx.taskOutputs.coordinate?.status === "success",
          transitionTo: "ready",
        },
        {
          id: "archive_card",
          label: "Archive",
          transitionTo: "done",
        },
      ],
    },
  ],
  initial: "ready",
  terminalStates: ["done"],
});

// --- Helpers ---
const initial: WorkflowInstanceState<
  { implement: {}; review: {}; coordinate: {} },
  "ready"
> = {
  currentState: "ready" as const,
  taskOutputs: {},
  hasRunningTask: false,
  runningTaskId: null,
  runningTaskContext: null,
  workflowInstanceState: {},
  history: [],
};

function apply(state: any, event: any): { state: any; commands: any[] } {
  return reduce(state, event, cardsWorkflow.states as any);
}

function visible(
  state: any,
  fromState?: string
): { id: string; label: string }[] {
  return getAvailableActions(
    cardsWorkflow.states as any,
    fromState ?? state.currentState,
    state
  );
}

// --- Tests ---

describe("cards workflow", () => {
  // 1. Initial state has "run" action available
  it("initial state shows run action", () => {
    const actions = visible(initial, "ready");
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.id, "run");
  });

  // 2. Dispatching "run" transitions to in_progress
  it("run action transitions to in_progress", () => {
    const result = apply(initial, {
      type: "action_triggered",
      actionId: "run",
      transitionTo: "in_progress",
    });

    assert.equal(result.state.currentState, "in_progress");
    assert.equal(result.state.hasRunningTask, false);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0]!.type, "start_auto_tasks");
  });

  // 3. After running, orchestrator starts implement task
  it("task_started sets hasRunningTask", () => {
    const state = { ...initial, currentState: "in_progress" };
    const result = apply(state, {
      type: "task_started",
      taskId: "implement",
      context: null,
    });

    assert.equal(result.state.hasRunningTask, true);
    assert.equal(result.state.runningTaskId, "implement");
  });

  // 4. Successful implement → auto-transitions to reviewing
  it("implement success transitions to reviewing", () => {
    const state = {
      currentState: "in_progress",
      taskOutputs: {},
      hasRunningTask: true,
      runningTaskId: "implement",
      runningTaskContext: { role: "ai-task" as const, messages: [] },
      workflowInstanceState: {},
      history: [],
    };

    const result = apply(state, {
      type: "task_completed",
      taskId: "implement",
      output: {},
    });

    assert.equal(result.state.currentState, "reviewing");
    assert.equal(result.state.hasRunningTask, false);
    assert.equal(result.state.runningTaskId, null);
    assert.equal(result.state.runningTaskContext, null);
    assert.equal(result.state.taskOutputs.implement?.status, "success");
    assert.equal(result.commands[0]!.type, "start_auto_tasks");
  });

  // 5. Errored implement → auto-transitions to ready
  it("implement error transitions to ready", () => {
    const state = {
      currentState: "in_progress",
      taskOutputs: {},
      hasRunningTask: true,
      runningTaskId: "implement",
      runningTaskContext: { role: "ai-task" as const, messages: [] },
      workflowInstanceState: {},
      history: [],
    };

    const result = apply(state, {
      type: "task_errored",
      taskId: "implement",
      error: "Something went wrong",
    });

    assert.equal(result.state.currentState, "ready");
    assert.equal(result.state.hasRunningTask, false);
    assert.equal(result.state.taskOutputs.implement?.status, "error");
  });

  // 6. While task is running, cancel action is available
  it("cancel action visible while task running", () => {
    const state = {
      currentState: "in_progress",
      taskOutputs: {},
      hasRunningTask: true,
      runningTaskId: "implement",
      runningTaskContext: { role: "ai-task" as const, messages: [] },
      workflowInstanceState: {},
    };

    const actions = visible(state, "in_progress");
    const cancel = actions.find((a) => a.id === "cancel");
    assert.ok(cancel);
  });

  // 7. Cancel action transitions to ready
  it("cancel transitions to ready", () => {
    const state = {
      currentState: "in_progress",
      taskOutputs: {},
      hasRunningTask: true,
      runningTaskId: "implement",
      runningTaskContext: { role: "ai-task" as const, messages: [] },
      workflowInstanceState: {},
      history: [],
    };

    const result = apply(state, {
      type: "action_triggered",
      actionId: "cancel",
      transitionTo: "ready",
    });

    assert.equal(result.state.currentState, "ready");
    assert.equal(result.state.hasRunningTask, false);
    assert.equal(result.state.runningTaskId, null);
  });

  // 8. In reviewing, success → accept action visible
  it("review success shows accept action", () => {
    const state = {
      currentState: "reviewing",
      taskOutputs: {
        implement: { status: "success" as const, output: {} },
        review: {
          status: "success" as const,
          output: { verdict: "approved" as const },
        },
      },
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };

    const actions = visible(state, "reviewing");
    const accept = actions.find((a) => a.id === "accept");
    assert.ok(accept);
    // changes_requested actions should NOT be visible
    assert.equal(
      actions.find((a) => a.id === "accept_anyway"),
      undefined
    );
    assert.equal(
      actions.find((a) => a.id === "update_changes"),
      undefined
    );
    assert.equal(
      actions.find((a) => a.id === "new_changes"),
      undefined
    );
  });

  // 9. In reviewing, changes_requested shows change actions
  it("review changes_requested shows change actions", () => {
    const state = {
      currentState: "reviewing",
      taskOutputs: {
        implement: { status: "success" as const, output: {} },
        review: {
          status: "success" as const,
          output: { verdict: "changes_requested" as const },
        },
      },
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };

    const actions = visible(state, "reviewing");
    assert.equal(
      actions.find((a) => a.id === "accept"),
      undefined
    );
    assert.ok(actions.find((a) => a.id === "accept_anyway"));
    assert.ok(actions.find((a) => a.id === "update_changes"));
    assert.ok(actions.find((a) => a.id === "new_changes"));
  });

  // 10. Accept transitions to done
  it("accept action transitions to done", () => {
    const state = { ...initial, currentState: "reviewing" };
    const result = apply(state, {
      type: "action_triggered",
      actionId: "accept",
      transitionTo: "done",
    });

    assert.equal(result.state.currentState, "done");
  });

  // 11. update_changes transitions to in_progress
  it("update_changes transitions to in_progress", () => {
    const state = { ...initial, currentState: "reviewing" };
    const result = apply(state, {
      type: "action_triggered",
      actionId: "update_changes",
      transitionTo: "in_progress",
    });

    assert.equal(result.state.currentState, "in_progress");
  });

  // 12. new_changes transitions to ready
  it("new_changes transitions to ready", () => {
    const state = { ...initial, currentState: "reviewing" };
    const result = apply(state, {
      type: "action_triggered",
      actionId: "new_changes",
      transitionTo: "ready",
    });

    assert.equal(result.state.currentState, "ready");
  });

  // 13. Review error → restart_review action visible
  it("review error shows retry action", () => {
    const state = {
      currentState: "reviewing",
      taskOutputs: {
        implement: { status: "success" as const, output: {} },
        review: {
          status: "error" as const,
          error: "Failed",
          output: undefined,
        },
      },
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
    };

    const actions = visible(state, "reviewing");
    const retry = actions.find((a) => a.id === "restart_review");
    assert.ok(retry);
  });

  // 14. task_cancelled clears running state
  it("task_cancelled clears hasRunningTask", () => {
    const state = {
      currentState: "in_progress",
      taskOutputs: {},
      hasRunningTask: true,
      runningTaskId: "implement",
      runningTaskContext: { role: "ai-task" as const, messages: [] },
      workflowInstanceState: {},
      history: [],
    };

    const result = apply(state, {
      type: "task_cancelled",
      taskId: "implement",
    });

    assert.equal(result.state.hasRunningTask, false);
    assert.equal(result.state.runningTaskId, null);
    assert.equal(result.state.runningTaskContext, null);
  });
});
