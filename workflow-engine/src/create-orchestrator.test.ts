import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOrchestrator } from "./create-orchestrator";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import { defineWorkflow } from "./workflow-types";

const testWorkflow = defineWorkflow({
  id: "test",
  label: "Test Workflow",
  taskOutputs: {
    doWork: {} as { result: string },
  },
  states: [
    {
      id: "idle",
      label: "Idle",
      actions: [
        {
          id: "start",
          label: "Start",
          effect: () => ({ transitionTo: "working" }),
        },
      ],
    },
    {
      id: "working",
      label: "Working",
      tasks: [
        {
          id: "doWork",
          label: "Do the work",
          trigger: "auto",
          role: "ai-task",
        },
      ],
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.doWork?.status === "success",
        },
        {
          to: "idle",
          gate: (ctx) => ctx.taskOutputs.doWork?.status === "error",
        },
      ],
      actions: [
        {
          id: "cancel",
          label: "Cancel",
          gate: (ctx) => ctx.hasRunningTask,
          effect: () => ({ transitionTo: "idle" }),
        },
      ],
    },
    { id: "done", label: "Done" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

// --- Mock runner ---

class MockRunner implements TaskRunner {
  private shouldFail: boolean;
  private pendingResolve: ((value: { output: unknown }) => void) | null;
  private pendingReject: ((reason: Error) => void) | null;
  cancelled: boolean;

  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.cancelled = false;
  }

  run(_task: TaskDefinition): Promise<{ output: unknown }> {
    return new Promise((resolve, reject) => {
      if (this.shouldFail) {
        reject(new Error("Task failed"));
        return;
      }
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.pendingReject?.(new Error("Cancelled"));
  }

  complete(output: unknown): void {
    this.pendingResolve?.({ output });
    this.pendingResolve = null;
  }
}

// --- Tests ---

describe("createOrchestrator", () => {
  it("starts in initial state", () => {
    const orchestrator = createOrchestrator(testWorkflow, {});
    assert.equal(orchestrator.getState().currentState, "idle");
  });

  it("getAvailableActions returns initial actions", () => {
    const orchestrator = createOrchestrator(testWorkflow, {});
    const actions = orchestrator.getAvailableActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.id, "start");
  });

  it("dispatchAction transitions state and starts auto tasks", async () => {
    const runner = new MockRunner();
    const orchestrator = createOrchestrator(testWorkflow, {
      "ai-task": runner,
    });

    orchestrator.dispatchAction("start");

    // After dispatch, state should be "working"
    assert.equal(orchestrator.getState().currentState, "working");

    // Auto task should be starting (hasRunningTask = true)
    assert.equal(orchestrator.getState().hasRunningTask, true);
    assert.equal(orchestrator.getState().runningTaskId, "doWork");

    // Complete the task
    runner.complete("success");

    // Allow microtask to clear
    await new Promise((r) => setTimeout(r, 0));

    // Should transition to done
    assert.equal(orchestrator.getState().currentState, "done");
    assert.equal(orchestrator.getState().hasRunningTask, false);
  });

  it("cancel transitions back to idle", async () => {
    const runner = new MockRunner();
    const orchestrator = createOrchestrator(testWorkflow, {
      "ai-task": runner,
    });

    orchestrator.dispatchAction("start");
    assert.equal(orchestrator.getState().currentState, "working");

    orchestrator.dispatchAction("cancel");
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(orchestrator.getState().currentState, "idle");
    assert.equal(orchestrator.getState().hasRunningTask, false);
  });

  it("emits state_changed event", () => {
    const orchestrator = createOrchestrator(testWorkflow, {});
    const events: string[] = [];
    orchestrator.on((event) => {
      events.push(event.type);
    });

    orchestrator.dispatchAction("start");
    assert.ok(events.includes("state_changed"));
    assert.ok(events.includes("available_actions_changed"));
  });

  it("task error returns to idle", async () => {
    const runner = new MockRunner(true);
    const orchestrator = createOrchestrator(testWorkflow, {
      "ai-task": runner,
    });

    orchestrator.dispatchAction("start");
    assert.equal(orchestrator.getState().currentState, "working");

    await new Promise((r) => setTimeout(r, 0));

    assert.equal(orchestrator.getState().currentState, "idle");
    assert.equal(orchestrator.getState().taskOutputs.doWork?.status, "error");
  });

  it("cancel action is visible while task is running", () => {
    const runner = new MockRunner();
    const orchestrator = createOrchestrator(testWorkflow, {
      "ai-task": runner,
    });

    orchestrator.dispatchAction("start");
    assert.equal(orchestrator.getState().hasRunningTask, true);

    const actions = orchestrator.getAvailableActions();
    assert.ok(actions.find((a) => a.id === "cancel"));
  });
});
