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
          transitionTo: "working",
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
          transitionTo: "idle",
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

// --- Manual task workflow (for startTask tests) ---

const manualTaskWorkflow = defineWorkflow({
  id: "session",
  label: "Session Workflow",
  taskOutputs: {
    chat: {} as { result: string },
  },
  states: [
    {
      id: "waiting",
      label: "Waiting",
      actions: [
        {
          id: "begin",
          label: "Begin session",
          transitionTo: "session_active",
        },
      ],
    },
    {
      id: "session_active",
      label: "Session Active",
      tasks: [
        {
          id: "chat",
          label: "Chat session",
          trigger: "manual",
          role: "ai-chat",
        },
      ],
      autoTransitions: [
        {
          to: "complete",
          gate: (ctx) => ctx.taskOutputs.chat?.status === "success",
        },
      ],
      actions: [
        {
          id: "cancel",
          label: "Cancel",
          gate: (ctx) => ctx.hasRunningTask,
          transitionTo: "waiting",
        },
      ],
    },
    { id: "complete", label: "Complete" },
  ],
  initial: "waiting",
  terminalStates: ["complete"],
});

// --- Chatty Mock Runner ---

class ChattyMockRunner implements TaskRunner {
  private pendingResolve: ((value: { output: unknown }) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  cancelled = false;
  receivedMessages: { content: string; role: string }[] = [];
  runStarted = false;

  run(_task: TaskDefinition): Promise<{ output: unknown }> {
    this.runStarted = true;
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.pendingReject?.(new Error("Cancelled"));
  }

  async sendMessage(content: string, role: string): Promise<void> {
    this.receivedMessages.push({ content, role });
  }

  complete(output: unknown): void {
    this.pendingResolve?.({ output });
  }
}

describe("startTask", () => {
  it("starts a manual task runner", async () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.dispatchAction("begin");
    assert.equal(orchestrator.getState().currentState, "session_active");

    const taskPromise = orchestrator.startTask("chat");
    // Dispatch should be synchronous — hasRunningTask set before await
    assert.equal(orchestrator.getState().hasRunningTask, true);
    assert.equal(orchestrator.getState().runningTaskId, "chat");
    assert.equal(runner.runStarted, true);

    runner.complete("output");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });

  it("completes task when runner resolves", async () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.dispatchAction("begin");

    const taskPromise = orchestrator.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));
    runner.complete("done");
    await taskPromise;

    assert.equal(orchestrator.getState().currentState, "complete");
    assert.equal(orchestrator.getState().hasRunningTask, false);
  });

  it("is no-op when task is already running", async () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.dispatchAction("begin");

    const firstTask = orchestrator.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    runner.runStarted = false;
    await orchestrator.startTask("chat");

    assert.equal(runner.runStarted, false);

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await firstTask;
  });
});

describe("sendTaskInput", () => {
  it("delegates to the running runner", async () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.dispatchAction("begin");

    const taskPromise = orchestrator.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    orchestrator.sendTaskInput("chat", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 1);
    assert.equal(runner.receivedMessages[0]!.content, "Hello");
    assert.equal(runner.receivedMessages[0]!.role, "user");

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });

  it("is no-op when no task is running", () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.sendTaskInput("nonexistent", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 0);
  });

  it("is no-op when wrong taskId specified", async () => {
    const runner = new ChattyMockRunner();
    const orchestrator = createOrchestrator(manualTaskWorkflow, {
      "ai-chat": runner,
    });

    orchestrator.dispatchAction("begin");

    const taskPromise = orchestrator.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    orchestrator.sendTaskInput("wrong-task", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 0);

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });
});
