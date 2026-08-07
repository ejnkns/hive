import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkflowInstanceController } from "./create-workflow-instance-controller";
import type {
  TaskDefinition,
  TaskRunner,
  TaskRunnerContext,
} from "./task-runner";
import {
  type ChatMessage,
  defineWorkflow,
  type WorkflowHistoryEntry,
} from "./workflow-types";

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

describe("createWorkflowInstanceController", () => {
  it("starts in initial state", () => {
    const controller = createWorkflowInstanceController(testWorkflow, {});
    assert.equal(controller.getState().currentState, "idle");
  });

  it("getAvailableActions returns initial actions", () => {
    const controller = createWorkflowInstanceController(testWorkflow, {});
    const actions = controller.getAvailableActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.id, "start");
  });

  it("dispatchAction transitions state and starts auto tasks", async () => {
    const runner = new MockRunner();
    const controller = createWorkflowInstanceController(testWorkflow, {
      "ai-task": () => runner,
    });

    controller.dispatchAction("start");

    // After dispatch, state should be "working"
    assert.equal(controller.getState().currentState, "working");

    // Auto task should be starting (hasRunningTask = true)
    assert.equal(controller.getState().hasRunningTask, true);
    assert.equal(controller.getState().runningTaskId, "doWork");

    // Complete the task
    runner.complete("success");

    // Allow microtask to clear
    await new Promise((r) => setTimeout(r, 0));

    // Should transition to done
    assert.equal(controller.getState().currentState, "done");
    assert.equal(controller.getState().hasRunningTask, false);
  });

  it("cancel transitions back to idle", async () => {
    const runner = new MockRunner();
    const controller = createWorkflowInstanceController(testWorkflow, {
      "ai-task": () => runner,
    });

    controller.dispatchAction("start");
    assert.equal(controller.getState().currentState, "working");

    controller.dispatchAction("cancel");
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(controller.getState().currentState, "idle");
    assert.equal(controller.getState().hasRunningTask, false);
  });

  it("emits state_changed event", () => {
    const controller = createWorkflowInstanceController(testWorkflow, {});
    const events: string[] = [];
    controller.on((event) => {
      events.push(event.type);
    });

    controller.dispatchAction("start");
    assert.ok(events.includes("state_changed"));
    assert.ok(events.includes("available_actions_changed"));
  });

  it("task error returns to idle", async () => {
    const runner = new MockRunner(true);
    const controller = createWorkflowInstanceController(testWorkflow, {
      "ai-task": () => runner,
    });

    controller.dispatchAction("start");
    assert.equal(controller.getState().currentState, "working");

    await new Promise((r) => setTimeout(r, 0));

    assert.equal(controller.getState().currentState, "idle");
    assert.equal(controller.getState().taskOutputs.doWork?.status, "error");
  });

  it("cancel action is visible while task is running", () => {
    const runner = new MockRunner();
    const controller = createWorkflowInstanceController(testWorkflow, {
      "ai-task": () => runner,
    });

    controller.dispatchAction("start");
    assert.equal(controller.getState().hasRunningTask, true);

    const actions = controller.getAvailableActions();
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
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.dispatchAction("begin");
    assert.equal(controller.getState().currentState, "session_active");

    const taskPromise = controller.startTask("chat");
    // Dispatch should be synchronous — hasRunningTask set before await
    assert.equal(controller.getState().hasRunningTask, true);
    assert.equal(controller.getState().runningTaskId, "chat");
    assert.equal(runner.runStarted, true);

    runner.complete("output");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });

  it("completes task when runner resolves", async () => {
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.dispatchAction("begin");

    const taskPromise = controller.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));
    runner.complete("done");
    await taskPromise;

    assert.equal(controller.getState().currentState, "complete");
    assert.equal(controller.getState().hasRunningTask, false);
  });

  it("is no-op when task is already running", async () => {
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.dispatchAction("begin");

    const firstTask = controller.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    runner.runStarted = false;
    await controller.startTask("chat");

    assert.equal(runner.runStarted, false);

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await firstTask;
  });
});

describe("sendTaskInput", () => {
  it("delegates to the running runner", async () => {
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.dispatchAction("begin");

    const taskPromise = controller.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    controller.sendTaskInput("chat", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 1);
    assert.equal(runner.receivedMessages[0]!.content, "Hello");
    assert.equal(runner.receivedMessages[0]!.role, "user");

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });

  it("is no-op when no task is running", () => {
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.sendTaskInput("nonexistent", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 0);
  });

  it("is no-op when wrong taskId specified", async () => {
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": () => runner,
    });

    controller.dispatchAction("begin");

    const taskPromise = controller.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    controller.sendTaskInput("wrong-task", "Hello", "user");
    assert.equal(runner.receivedMessages.length, 0);

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });

  it("creates a fresh runner per execution so concurrent tasks stay isolated", () => {
    const created: ChattyMockRunner[] = [];
    const factory = () => {
      const runner = new ChattyMockRunner();
      created.push(runner);
      return runner;
    };

    const a = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": factory,
    });
    const b = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": factory,
    });

    a.dispatchAction("begin");
    b.dispatchAction("begin");
    void a.startTask("chat");
    void b.startTask("chat");

    assert.equal(created.length, 2);
    assert.notEqual(created[0], created[1]);

    a.sendTaskInput("chat", "hello A", "user");
    b.sendTaskInput("chat", "hello B", "user");

    assert.deepEqual(created[0]!.receivedMessages, [
      { content: "hello A", role: "user" },
    ]);
    assert.deepEqual(created[1]!.receivedMessages, [
      { content: "hello B", role: "user" },
    ]);
  });

  it("patchRunningTaskMessages syncs the transcript into state and emits state_changed", async () => {
    // Assigned by the factory below when the task starts; definite assignment
    // because the assignment happens inside the runner-factory callback.
    let capturedCtx!: TaskRunnerContext;
    const runner = new ChattyMockRunner();
    const controller = createWorkflowInstanceController(manualTaskWorkflow, {
      "ai-chat": (ctx) => {
        capturedCtx = ctx;
        return runner;
      },
    });

    const events: string[] = [];
    controller.on((event) => events.push(event.type));

    controller.dispatchAction("begin");
    const taskPromise = controller.startTask("chat");
    await new Promise((r) => setTimeout(r, 0));

    capturedCtx.patchRunningTaskMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    const runningContext = controller.getState().runningTaskContext;
    assert.ok(runningContext && runningContext.role === "ai-chat");
    assert.deepEqual(
      runningContext.messages.map((m) => m.content),
      ["hello", "hi"]
    );
    assert.ok(
      events.filter((event) => event === "state_changed").length >= 1,
      "syncing messages should emit a state_changed"
    );

    runner.complete("done");
    await new Promise((r) => setTimeout(r, 0));
    await taskPromise;
  });
});

// ── HITL ai-chat session completion ──────────────────────────────

const hitlWorkflow = defineWorkflow({
  id: "hitl",
  label: "HITL Session",
  taskOutputs: {
    interview: {} as { messages: ChatMessage[] },
  },
  states: [
    {
      id: "idle",
      label: "Idle",
      actions: [
        {
          id: "begin",
          label: "Begin",
          transitionTo: "session",
        },
      ],
    },
    {
      id: "session",
      label: "Session",
      tasks: [
        {
          id: "interview",
          label: "Interview",
          trigger: "manual",
          role: "ai-chat",
          systemPrompt: "You are a HITL interviewer.",
        },
      ],
      actions: [
        {
          id: "complete_session",
          label: "Complete",
          variant: "primary",
          gate: (ctx) => ctx.hasRunningTask,
          completesRunningTask: true,
          transitionTo: "complete",
        },
      ],
    },
    {
      id: "complete",
      label: "Complete",
      actions: [
        {
          id: "confirm",
          label: "Confirm transcript",
          gate: (ctx) =>
            (ctx.taskOutputs.interview?.output.messages.length ?? 0) > 0,
          transitionTo: "done",
        },
      ],
    },
    { id: "done", label: "Done" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

// Mirrors the ai-chat runner: holds a pending run() until cancelled, syncs its
// transcript into instance state at each turn so the recorded output is the
// live transcript, and rejects run() on cancel so executeTask's catch path
// runs.
class HitlMockRunner implements TaskRunner {
  private pendingReject: ((reason: Error) => void) | null = null;
  private messages: ChatMessage[];
  private patchMessages: (messages: ChatMessage[]) => void;
  cancelled = false;

  constructor(patchMessages: (messages: ChatMessage[]) => void) {
    this.messages = [];
    this.patchMessages = patchMessages;
  }

  run(task: TaskDefinition): Promise<{ output: unknown }> {
    this.messages = [{ role: "system", content: task.systemPrompt ?? "" }];
    this.patchMessages(this.messages);
    return new Promise((_resolve, reject) => {
      this.pendingReject = reject;
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.pendingReject?.(new Error("Cancelled"));
  }

  async sendMessage(content: string, role: string): Promise<void> {
    this.messages.push({ role: role as ChatMessage["role"], content });
    this.patchMessages(this.messages);
  }
}

describe("HITL ai-chat session completion", () => {
  it("completes a running session with its transcript as the task output", async () => {
    let runner!: HitlMockRunner;
    const controller = createWorkflowInstanceController(hitlWorkflow, {
      "ai-chat": (ctx) => {
        runner = new HitlMockRunner(ctx.patchRunningTaskMessages);
        return runner;
      },
    });

    controller.dispatchAction("begin");
    const taskPromise = controller.startTask("interview");
    await new Promise((r) => setTimeout(r, 0));

    controller.sendTaskInput("interview", "What did you build?", "user");

    const runningContext = controller.getState().runningTaskContext;
    assert.ok(runningContext && runningContext.role === "ai-chat");
    const transcript = [...runningContext.messages];
    assert.deepEqual(
      transcript.map((m) => m.content),
      ["You are a HITL interviewer.", "What did you build?"]
    );

    controller.dispatchAction("complete_session");

    const state = controller.getState();
    assert.equal(state.currentState, "complete");
    assert.equal(state.hasRunningTask, false);
    assert.equal(state.runningTaskId, null);
    assert.equal(state.runningTaskContext, null);

    // The captured transcript is the task output, recorded as success.
    assert.equal(state.taskOutputs.interview?.status, "success");
    assert.deepEqual(state.taskOutputs.interview?.output, {
      messages: transcript,
    });
    assert.equal(runner.cancelled, true);

    const executionEntry = state.history.find(
      (h): h is Extract<WorkflowHistoryEntry, { type: "task_execution" }> =>
        h.type === "task_execution" && h.taskId === "interview"
    );
    assert.ok(executionEntry);
    assert.equal(executionEntry.status, "success");

    await taskPromise;
  });

  it("a follow-on gate can read the completed session transcript", async () => {
    const controller = createWorkflowInstanceController(hitlWorkflow, {
      "ai-chat": (ctx) => new HitlMockRunner(ctx.patchRunningTaskMessages),
    });

    controller.dispatchAction("begin");
    const taskPromise = controller.startTask("interview");
    await new Promise((r) => setTimeout(r, 0));

    controller.sendTaskInput("interview", "Hello", "user");
    controller.dispatchAction("complete_session");

    assert.equal(controller.getState().currentState, "complete");
    const actions = controller.getAvailableActions();
    assert.ok(actions.find((a) => a.id === "confirm"));

    await taskPromise;
  });
});

// ── countItems gate test ─────────────────────────────────────────

const concurrentWorkflow = defineWorkflow({
  id: "concurrent",
  label: "Concurrent",
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "idle",
      label: "Idle",
      actions: [
        {
          id: "go",
          label: "Go",
          gate: (ctx) =>
            (ctx.workflowInstancesInState?.("active").length ?? 0) < 2,
          transitionTo: "active",
        },
      ],
    },
    {
      id: "active",
      label: "Active",
      actions: [
        {
          id: "back",
          label: "Back",
          transitionTo: "idle",
        },
      ],
    },
  ],
  initial: "idle",
  terminalStates: [],
});

describe("workflowInstancesInState", () => {
  it("shows action when under limit", () => {
    const controller = createWorkflowInstanceController(
      concurrentWorkflow,
      {},
      undefined,
      () => []
    );
    const actions = controller.getAvailableActions();
    assert.ok(actions.find((a) => a.id === "go"));
  });

  it("hides action when at limit", () => {
    const controller = createWorkflowInstanceController(
      concurrentWorkflow,
      {},
      undefined,
      () => [
        { currentState: "active", id: "a", workflowInstanceState: {} },
        { currentState: "active", id: "b", workflowInstanceState: {} },
      ]
    );
    const actions = controller.getAvailableActions();
    assert.equal(
      actions.find((a) => a.id === "go"),
      undefined
    );
  });
});

// --- dependsOnState gating ---

const dependencyWorkflow = defineWorkflow({
  id: "dependency",
  label: "Dependency",
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "blocked",
      label: "Blocked",
      actions: [
        {
          id: "proceed",
          label: "Proceed",
          dependsOnState: "done",
          transitionTo: "running",
        },
      ],
    },
    { id: "running", label: "Running" },
  ],
  initial: "blocked",
  terminalStates: ["running"],
});

// A workflow whose instances are known by a title hint (like queen-bee cards):
// the dependsOnState gate must also match name-based dependencies against the
// titles of instances already in the target state (resolution to IDs runs only
// on edge fan-out, so rehydrated or directly-created instances carry names).
const titledDependencyWorkflow = defineWorkflow({
  id: "titled-dependency",
  label: "Titled Dependency",
  instance: { title: "name" },
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "blocked",
      label: "Blocked",
      actions: [
        {
          id: "proceed",
          label: "Proceed",
          dependsOnState: "done",
          transitionTo: "running",
        },
      ],
    },
    { id: "running", label: "Running" },
  ],
  initial: "blocked",
  terminalStates: ["running"],
});

describe("dependsOnState gating", () => {
  it("blocks dispatch until every dependee is in the target state", () => {
    const controller = createWorkflowInstanceController(
      dependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { dependsOn: ["target-1"] },
        history: [],
      },
      () => []
    );

    controller.dispatchAction("proceed");
    assert.equal(controller.getState().currentState, "blocked");
  });

  it("dispatches when every dependee is in the target state", () => {
    const controller = createWorkflowInstanceController(
      dependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { dependsOn: ["target-1"] },
        history: [],
      },
      () => [
        { currentState: "done", id: "target-1", workflowInstanceState: {} },
      ]
    );

    controller.dispatchAction("proceed");
    assert.equal(controller.getState().currentState, "running");
  });

  it("blocks when only some dependees are in the target state", () => {
    const controller = createWorkflowInstanceController(
      dependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { dependsOn: ["target-1", "target-2"] },
        history: [],
      },
      () => [
        { currentState: "done", id: "target-1", workflowInstanceState: {} },
      ]
    );

    controller.dispatchAction("proceed");
    assert.equal(controller.getState().currentState, "blocked");
  });

  it("matches a name-based dependee against the title of an instance in the target state", () => {
    const controller = createWorkflowInstanceController(
      titledDependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        // The dependency is still recorded by name (resolution never ran).
        workflowInstanceState: {
          dependsOn: [
            "Shape state and rendering for square, triangle, and diamond",
          ],
        },
        history: [],
      },
      () => [
        {
          currentState: "done",
          id: "target-1",
          workflowInstanceState: {
            name: "Shape state and rendering for square, triangle, and diamond",
          },
        },
      ]
    );

    controller.dispatchAction("proceed");
    assert.equal(controller.getState().currentState, "running");
  });

  it("blocks a name-based dependee whose title is not in the target state", () => {
    const controller = createWorkflowInstanceController(
      titledDependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { dependsOn: ["Missing title"] },
        history: [],
      },
      () => [
        {
          currentState: "done",
          id: "target-1",
          workflowInstanceState: { name: "Some other card" },
        },
      ]
    );

    controller.dispatchAction("proceed");
    assert.equal(controller.getState().currentState, "blocked");
  });

  it("exposes the run action when a name-based dependee's title is in the target state", () => {
    const controller = createWorkflowInstanceController(
      titledDependencyWorkflow,
      {},
      {
        currentState: "blocked",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { dependsOn: ["Done card title"] },
        history: [],
      },
      () => [
        {
          currentState: "done",
          id: "target-1",
          workflowInstanceState: { name: "Done card title" },
        },
      ]
    );

    const actions = controller.getAvailableActions();
    assert.ok(
      actions.some((action) => action.id === "proceed"),
      "run action should be visible once its named dependency is done"
    );
  });
});
