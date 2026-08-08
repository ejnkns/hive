import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createFlowRuntime,
  type FlowPersistence,
  type FlowRuntimeEvent,
} from "./create-flow-runtime";
import { createAiTaskRunner } from "./runners/create-ai-task-runner";
import { createOperationRunner } from "./runners/create-operation-runner";
import {
  createStandardToolDefinitions,
  createStandardToolRegistry,
} from "./runners/create-standard-tool-registry";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import { defineWorkflow, type FlowEdge } from "./workflow-types";

// ─── Test workflows ───

const sourceWorkflow = defineWorkflow({
  id: "source",
  label: "Source",
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
          label: "Do work",
          trigger: "auto",
          role: "ai-task",
        },
      ],
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.taskOutputs.doWork?.status === "success",
        },
      ],
    },
    { id: "done", label: "Done" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

const targetWorkflow = defineWorkflow({
  id: "target",
  label: "Target",
  taskOutputs: {} as Record<string, never>,
  states: [{ id: "ready", label: "Ready" }],
  initial: "ready",
  terminalStates: ["ready"],
});

// ─── Mock Runner ───

class MockRunner implements TaskRunner {
  private pendingResolve: ((value: { output: unknown }) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  cancelled = false;

  run(_task: TaskDefinition): Promise<{ output: unknown }> {
    return new Promise((resolve, reject) => {
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

// ─── Tests ───

describe("FlowRuntime", () => {
  describe("getFlowConfig / getFlowState", () => {
    it("returns initial flow config", () => {
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow],
        [],
        {},
        {
          basePath: "/tmp/repo",
        }
      );
      assert.deepEqual(runtime.getFlowConfig(), { basePath: "/tmp/repo" });
    });

    it("returns initial flow state", () => {
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow],
        [],
        {},
        {},
        { requirementsContent: "initial" }
      );
      assert.deepEqual(runtime.getFlowState(), {
        requirementsContent: "initial",
      });
    });

    it("defaults to empty config and state", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      assert.deepEqual(runtime.getFlowConfig(), {});
      assert.deepEqual(runtime.getFlowState(), {});
    });
  });

  describe("patchFlowState", () => {
    it("merges patch into flow state", () => {
      const runtime = createFlowRuntime<
        Record<string, unknown>,
        Record<string, unknown>
      >("test", [sourceWorkflow], [], {}, {}, { a: 1 });
      runtime.patchFlowState({ b: 2 });
      assert.deepEqual(runtime.getFlowState(), { a: 1, b: 2 });
    });

    it("emits flow_state_changed event", () => {
      const runtime = createFlowRuntime<
        Record<string, unknown>,
        Record<string, unknown>
      >("test", [sourceWorkflow], [], {});
      const events: string[] = [];
      runtime.on((event) => events.push(event.type));
      runtime.patchFlowState({ key: "val" });
      assert.ok(events.includes("flow_state_changed"));
    });

    it("mutates the same object reference so controllers see updates", () => {
      const runtime = createFlowRuntime<
        Record<string, unknown>,
        Record<string, unknown>
      >("test", [sourceWorkflow], [], {}, {}, { shared: "original" });
      runtime.patchFlowState({ shared: "updated" });
      // The same object reference is mutated in-place
      const state = runtime.getFlowState();
      assert.equal(state.shared, "updated");
    });
  });

  describe("addWorkflowInstance", () => {
    it("creates a controller in the workflow's initial state", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      const controller = runtime.addWorkflowInstance("source");
      assert.equal(controller.getState().currentState, "idle");
    });

    it("accepts custom initial state overrides", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      const controller = runtime.addWorkflowInstance("source", {
        currentState: "done",
        taskOutputs: {
          doWork: { status: "success", output: { result: "ok" } },
        },
      });
      assert.equal(controller.getState().currentState, "done");
      assert.deepEqual(controller.getState().taskOutputs.doWork?.output, {
        result: "ok",
      });
    });

    it("throws for unknown workflow id", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      assert.throws(
        () => runtime.addWorkflowInstance("nonexistent"),
        /Workflow "nonexistent" not found/
      );
    });

    it("emits instance_created event", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      const events: string[] = [];
      runtime.on((event) => events.push(event.type));
      runtime.addWorkflowInstance("source");
      assert.ok(events.includes("instance_created"));
    });

    it("instance_created event carries workflowId and instanceId", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      const created: Extract<FlowRuntimeEvent, { type: "instance_created" }>[] =
        [];
      runtime.on((e) => {
        if (e.type === "instance_created") created.push(e);
      });
      runtime.addWorkflowInstance("source");
      assert.equal(created.length, 1);
      assert.equal(created[0].workflowId, "source");
      assert.ok(created[0].instanceId);
    });

    it("auto-starts initial-state auto tasks on fresh instances", async () => {
      const bootWorkflow = defineWorkflow({
        id: "boot",
        label: "Boot",
        taskOutputs: { greet: {} as { ok: boolean } },
        states: [
          {
            id: "initial",
            label: "Initial",
            tasks: [
              {
                id: "greet",
                label: "Greet",
                trigger: "auto",
                role: "operation",
                operations: ["greet"],
              },
            ],
          },
          { id: "done", label: "Done" },
        ],
        initial: "initial",
        terminalStates: ["done"],
      });

      let ran = false;
      const runtime = createFlowRuntime("test", [bootWorkflow], [], {
        operation: () =>
          createOperationRunner({
            operations: {
              greet: () => {
                ran = true;
                return { ok: true };
              },
            },
          }),
      });

      runtime.addWorkflowInstance("boot");
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(ran, true);
    });

    it("does not auto-start restored instances with taskOutputs", async () => {
      const bootWorkflow = defineWorkflow({
        id: "boot",
        label: "Boot",
        taskOutputs: { greet: {} as { ok: boolean } },
        states: [
          {
            id: "initial",
            label: "Initial",
            tasks: [
              {
                id: "greet",
                label: "Greet",
                trigger: "auto",
                role: "operation",
                operations: ["greet"],
              },
            ],
          },
          { id: "done", label: "Done" },
        ],
        initial: "initial",
        terminalStates: ["done"],
      });

      let ran = false;
      const runtime = createFlowRuntime("test", [bootWorkflow], [], {
        operation: () =>
          createOperationRunner({
            operations: {
              greet: () => {
                ran = true;
                return { ok: true };
              },
            },
          }),
      });

      runtime.addWorkflowInstance("boot", {
        currentState: "initial",
        taskOutputs: {
          greet: { status: "success", output: { ok: true } },
        },
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: {},
        history: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(ran, false);
    });
  });

  describe("getWorkflowInstance", () => {
    it("returns undefined for unknown instance id", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      assert.equal(runtime.getWorkflowInstance("unknown"), undefined);
    });

    it("returns controller by id from instance_created event", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      let instanceId: string | undefined;
      runtime.on((event) => {
        if (event.type === "instance_created") instanceId = event.instanceId;
      });
      const controller = runtime.addWorkflowInstance("source");
      assert.ok(instanceId);
      assert.equal(runtime.getWorkflowInstance(instanceId), controller);
    });
  });

  describe("workflowInstances", () => {
    it("returns empty array initially", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      assert.deepEqual(runtime.workflowInstances, []);
    });

    it("returns states for all instances", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      runtime.addWorkflowInstance("source");
      runtime.addWorkflowInstance("source");
      assert.equal(runtime.workflowInstances.length, 2);
      assert.equal(runtime.workflowInstances[0].currentState, "idle");
      assert.equal(runtime.workflowInstances[1].currentState, "idle");
    });
  });

  describe("workflowInstancesInState", () => {
    it("returns all instances when called without stateId", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      runtime.addWorkflowInstance("source");
      runtime.addWorkflowInstance("source");
      assert.equal(runtime.workflowInstancesInState().length, 2);
    });

    it("filters by state id", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      runtime.addWorkflowInstance("source", {
        currentState: "idle",
      });
      runtime.addWorkflowInstance("source", {
        currentState: "done",
      });
      const idle = runtime.workflowInstancesInState("idle");
      const done = runtime.workflowInstancesInState("done");
      assert.equal(idle.length, 1);
      assert.equal(done.length, 1);
    });

    it("returns empty array for unknown state", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      runtime.addWorkflowInstance("source");
      assert.deepEqual(runtime.workflowInstancesInState("nonexistent"), []);
    });
  });

  describe("event subscription", () => {
    it("on adds event handler", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      let called = false;
      runtime.on(() => {
        called = true;
      });
      runtime.patchFlowState({});
      assert.ok(called);
    });

    it("returned unsubscribe removes handler", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      let callCount = 0;
      const unsub = runtime.on(() => {
        callCount++;
      });
      unsub();
      runtime.patchFlowState({});
      assert.equal(callCount, 0);
    });

    it("supports multiple handlers", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      let a = 0;
      let b = 0;
      runtime.on(() => a++);
      runtime.on(() => b++);
      runtime.patchFlowState({});
      assert.equal(a, 1);
      assert.equal(b, 1);
    });
  });

  describe("edge evaluation on terminal state (toWorkflow)", () => {
    it("creates new instance in target workflow", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");

      await new Promise((r) => setTimeout(r, 0));
      assert.equal(controller.getState().currentState, "working");

      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(controller.getState().currentState, "done");
      // Original instance + edge-created target instance
      assert.equal(runtime.workflowInstances.length, 2);
      assert.equal(runtime.workflowInstancesInState("ready").length, 1);
    });

    it("passes transformed data as workflowInstanceState", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
          transform: (source) => ({
            inherited: readOutputResult(source.doWork?.output) ?? null,
            dependsOn: ["parent-card"],
          }),
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "hello" });
      await new Promise((r) => setTimeout(r, 0));

      const targetInstances = runtime.workflowInstances.filter(
        (i) => i.currentState === "ready"
      );
      assert.equal(targetInstances.length, 1);
      assert.equal(targetInstances[0].workflowInstanceState.inherited, "hello");
      assert.deepEqual(targetInstances[0].workflowInstanceState.dependsOn, [
        "parent-card",
      ]);
    });

    it("does not fire edge for non-terminal state", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["working"],
          toWorkflow: "target",
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));

      // Not terminal yet, no edge should fire
      assert.equal(runtime.workflowInstances.length, 1);
    });

    it("does not fire edge for different workflow", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "other",
          fromStates: ["init"],
          toWorkflow: "target",
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(runtime.workflowInstances.length, 1);
    });

    it("emits instance_created for edge-created instances", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner }
      );

      const created: string[] = [];
      runtime.on((e) => {
        if (e.type === "instance_created") created.push(e.workflowId);
      });

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      assert.ok(created.includes("target"));
    });
  });

  describe("edge evaluation on terminal state (toFlowState)", () => {
    it("patches flow state with transformed data", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toFlowState: true,
          transform: (source) => ({
            lastResult: readOutputResult(source.doWork?.output) ?? null,
          }),
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow],
        edges,
        { "ai-task": () => runner },
        {},
        { lastResult: null }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "completed" });
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(runtime.getFlowState().lastResult, "completed");
    });

    it("emits flow_state_changed for toFlowState edge", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toFlowState: true,
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime("test", [sourceWorkflow], edges, {
        "ai-task": () => runner,
      });

      let stateChanged = false;
      runtime.on((e) => {
        if (e.type === "flow_state_changed") stateChanged = true;
      });

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      assert.ok(stateChanged);
    });
  });

  describe("combined edge evaluation", () => {
    it("handles both toWorkflow and toFlowState edges from same state", async () => {
      const edges: FlowEdge[] = [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
          transform: () => ({ origin: "source" }),
        },
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toFlowState: true,
          transform: () => ({ done: true }),
        },
      ];
      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test",
        [sourceWorkflow, targetWorkflow],
        edges,
        { "ai-task": () => runner },
        {},
        { done: false }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      // Both edges fire
      assert.equal(runtime.workflowInstances.length, 2);
      assert.equal(runtime.getFlowState().done, true);
    });
  });

  describe("instance_state_changed and instance_terminated events", () => {
    it("emits instance_state_changed on state transitions", () => {
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {});
      const states: string[] = [];
      runtime.on((e) => {
        if (e.type === "instance_state_changed")
          states.push(e.state.currentState);
      });
      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");

      // Initial: idle → working (transition via action)
      assert.ok(states.includes("working"));
    });

    it("emits instance_terminated when reaching terminal state", async () => {
      const runner = new MockRunner();
      const runtime = createFlowRuntime("test", [sourceWorkflow], [], {
        "ai-task": () => runner,
      });

      let terminated = false;
      runtime.on((e) => {
        if (e.type === "instance_terminated") terminated = true;
      });

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "ok" });
      await new Promise((r) => setTimeout(r, 0));

      assert.ok(terminated);
    });
  });

  describe("persistence hook", () => {
    it("calls persistence.saveFlow on patchFlowState", () => {
      const saved: Array<{ flowId: string; config: unknown; state: unknown }> =
        [];
      const persistence: FlowPersistence = {
        saveFlow(flowId, config, state) {
          saved.push({ flowId, config, state });
        },
        saveInstance() {},
      };

      const runtime = createFlowRuntime(
        "test-flow",
        [sourceWorkflow],
        [],
        {},
        { basePath: "/tmp" },
        { count: 0 },
        persistence
      );

      runtime.patchFlowState({ count: 1 });
      assert.equal(saved.length, 1);
      assert.equal(saved[0].flowId, "test-flow");
      const savedState = saved[0].state;
      assert.ok(
        savedState !== null &&
          typeof savedState === "object" &&
          "count" in savedState
      );
      assert.equal(savedState.count, 1);
    });

    it("calls persistence.saveInstance on state change", async () => {
      const saved: Array<{
        flowId: string;
        instanceId: string;
        state: unknown;
      }> = [];
      const persistence: FlowPersistence = {
        saveFlow() {},
        saveInstance(flowId, instanceId, _workflowId, state) {
          saved.push({ flowId, instanceId, state });
        },
      };

      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test-flow",
        [sourceWorkflow],
        [],
        { "ai-task": () => runner },
        {},
        {},
        persistence
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));

      // state_changed emitted for transition idle → working
      assert.ok(saved.length >= 1);
      assert.equal(saved[0].flowId, "test-flow");
    });
  });

  describe("persist on task completion", () => {
    let root: string;

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function buildRuntime(taskDef: {
      persist: { path: string };
      operationInputs?: Record<string, unknown>;
    }): ReturnType<typeof createFlowRuntime> {
      const persistWorkflow = defineWorkflow({
        id: "persist",
        label: "Persist",
        taskOutputs: { save: {} as { hello: string } },
        states: [
          {
            id: "ready",
            label: "Ready",
            tasks: [
              {
                id: "save",
                label: "Save",
                trigger: "auto",
                role: "operation",
                operations: ["save_output"],
                operationInputs: taskDef.operationInputs,
                persist: taskDef.persist,
              },
            ],
            autoTransitions: [
              {
                to: "done",
                gate: (ctx) => ctx.taskOutputs.save?.status === "success",
              },
            ],
          },
          { id: "done", label: "Done" },
        ],
        initial: "ready",
        terminalStates: ["done"],
      });

      return createFlowRuntime(
        "test",
        [persistWorkflow],
        [],
        {
          operation: () =>
            createOperationRunner({
              getContext: () => ({
                flowConfig: () => ({}),
                patchFlowConfig: () => {},
                instanceId: "",
                workflowId: "",
                currentState: "",
                workflowInstanceState: () => ({}),
                taskOutputs: () => ({}),
                patchWorkflowInstanceState: () => {},
                workflowInstancesInState: () => [],
              }),
              operations: {
                save_output: () => ({ hello: "world" }),
              },
            }),
        },
        {
          basePath: root,
          definitionId: "test",
        }
      );
    }

    async function waitForDone(
      runtime: ReturnType<typeof createFlowRuntime>
    ): Promise<void> {
      for (let i = 0; i < 200; i++) {
        const entries = runtime.getWorkflowInstanceEntries();
        if (entries.some((e) => e.state.currentState === "done")) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("persist workflow did not reach done");
    }

    it("writes task output to basePath/<domainDir>/<path> on success", async () => {
      root = mkdtempSync(join(tmpdir(), "hive-persist-"));
      const runtime = buildRuntime({ persist: { path: "output.json" } });
      runtime.addWorkflowInstance("persist");
      await waitForDone(runtime);

      const target = join(root, ".test", "output.json");
      assert.ok(existsSync(target));
      assert.deepEqual(JSON.parse(readFileSync(target, "utf-8")), {
        hello: "world",
      });
    });

    it("substitutes {instanceId} and {attempt} from the workflow instance", async () => {
      root = mkdtempSync(join(tmpdir(), "hive-persist-"));
      const runtime = buildRuntime({
        persist: { path: "reviews/{instanceId}-{attempt}.json" },
      });
      runtime.addWorkflowInstance("persist", {
        workflowInstanceState: { attempt: 2 },
      });
      await waitForDone(runtime);

      const reviewsDir = join(root, ".test", "reviews");
      assert.ok(existsSync(reviewsDir));
      const written = readdirSync(reviewsDir);
      assert.equal(written.length, 1);
      const entry = runtime
        .getWorkflowInstanceEntries()
        .find((e) => e.workflowId === "persist");
      assert.ok(entry);
      assert.equal(written[0], `${entry.id}-2.json`);
    });

    it("does not persist when no base path is bound", async () => {
      root = mkdtempSync(join(tmpdir(), "hive-persist-"));
      const runtime = createFlowRuntime(
        "test",
        [
          defineWorkflow({
            id: "persist",
            label: "Persist",
            taskOutputs: { save: {} as { hello: string } },
            states: [
              {
                id: "ready",
                label: "Ready",
                tasks: [
                  {
                    id: "save",
                    label: "Save",
                    trigger: "auto",
                    role: "operation",
                    operations: ["save_output"],
                    persist: { path: "output.json" },
                  },
                ],
                autoTransitions: [
                  {
                    to: "done",
                    gate: (ctx) => ctx.taskOutputs.save?.status === "success",
                  },
                ],
              },
              { id: "done", label: "Done" },
            ],
            initial: "ready",
            terminalStates: ["done"],
          }),
        ],
        [],
        {
          operation: () =>
            createOperationRunner({
              getContext: () => ({
                flowConfig: () => ({}),
                patchFlowConfig: () => {},
                instanceId: "",
                workflowId: "",
                currentState: "",
                workflowInstanceState: () => ({}),
                taskOutputs: () => ({}),
                patchWorkflowInstanceState: () => {},
                workflowInstancesInState: () => [],
              }),
              operations: {
                save_output: () => ({ hello: "world" }),
              },
            }),
        },
        { definitionId: "test" }
      );
      runtime.addWorkflowInstance("persist");
      await waitForDone(runtime);
      assert.ok(!existsSync(join(root, ".test")));
    });
  });
});

function readOutputResult(output: unknown): unknown {
  if (output === null || typeof output !== "object") return undefined;
  return "result" in output ? output.result : undefined;
}

// ── rendering hints serialization ──

describe("getWorkflowDefinitions serializes rendering hints", () => {
  it("carries instance, display, and per-workflow ui hints", () => {
    const hintedWorkflow = defineWorkflow({
      id: "hinted",
      label: "Hinted",
      instance: { title: "cardSpec.title", subtitle: "cardSpec.status" },
      display: {
        fields: [
          {
            path: "cardSpec",
            label: "Card spec",
            render: { kind: "card", props: { title: "title" } },
          },
        ],
      },
      ui: {
        instanceComponent: "CustomCard",
        columns: [
          {
            id: "ready",
            label: "Ready",
            states: ["ready"],
          },
          {
            id: "done",
            label: "Done",
            states: ["ready"],
          },
        ],
      },
      taskOutputs: {
        plan: {} as { cards: Array<{ title: string }> },
      },
      states: [
        {
          id: "ready",
          label: "Ready",
          tasks: [
            {
              id: "plan",
              label: "Plan",
              trigger: "auto",
              role: "ai-task",
              render: { kind: "cards", props: { items: "cards" } },
            },
          ],
        },
      ],
      initial: "ready",
      terminalStates: ["ready"],
    });

    const runtime = createFlowRuntime("test", [hintedWorkflow], [], {});
    const [def] = runtime.getWorkflowDefinitions();

    assert.deepEqual(def.instance, {
      title: "cardSpec.title",
      subtitle: "cardSpec.status",
    });
    assert.deepEqual(def.display, {
      fields: [
        {
          path: "cardSpec",
          label: "Card spec",
          render: { kind: "card", props: { title: "title" } },
        },
      ],
    });
    assert.deepEqual(def.ui, {
      instanceComponent: "CustomCard",
      columns: [
        { id: "ready", label: "Ready", states: ["ready"] },
        { id: "done", label: "Done", states: ["ready"] },
      ],
    });
  });

  it("serializes per-task render hints alongside task id and label", () => {
    const hintedWorkflow = defineWorkflow({
      id: "hinted",
      label: "Hinted",
      taskOutputs: {
        plan: {} as { cards: Array<{ title: string }> },
      },
      states: [
        {
          id: "ready",
          label: "Ready",
          tasks: [
            {
              id: "plan",
              label: "Run planner",
              trigger: "auto",
              role: "ai-task",
              render: {
                kind: "cards",
                props: {
                  items: "cards",
                  title: "title",
                  bullets: "acceptanceCriteria",
                },
              },
            },
          ],
        },
      ],
      initial: "ready",
      terminalStates: ["ready"],
    });

    const runtime = createFlowRuntime("test", [hintedWorkflow], [], {});
    const [def] = runtime.getWorkflowDefinitions();

    assert.deepEqual(def.states[0]?.tasks, [
      {
        id: "plan",
        label: "Run planner",
        render: {
          kind: "cards",
          props: {
            items: "cards",
            title: "title",
            bullets: "acceptanceCriteria",
          },
        },
      },
    ]);
  });

  it("omits render for tasks that declare none, and drops non-render task fields", () => {
    const plainWorkflow = defineWorkflow({
      id: "plain",
      label: "Plain",
      taskOutputs: {
        doWork: {} as { result: string },
      },
      states: [
        {
          id: "ready",
          label: "Ready",
          tasks: [
            {
              id: "doWork",
              label: "Do work",
              trigger: "auto",
              role: "operation",
              operations: ["do"],
              systemPrompt: "should not serialize",
            },
          ],
        },
      ],
      initial: "ready",
      terminalStates: ["ready"],
    });

    const runtime = createFlowRuntime("test", [plainWorkflow], [], {});
    const [def] = runtime.getWorkflowDefinitions();

    assert.deepEqual(def.states[0]?.tasks, [
      { id: "doWork", label: "Do work" },
    ]);
  });
});

// ── agent-created instances (create_instance) ──

const ticketWorkflow = defineWorkflow({
  id: "ticket",
  label: "Ticket",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "fog", label: "Fog", category: "initial" },
    { id: "closed", label: "Closed", category: "terminal" },
  ],
  initial: "fog",
  terminalStates: ["closed"],
});

const resolverWorkflow = defineWorkflow({
  id: "resolver",
  label: "Resolver",
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "working",
      label: "Working",
      category: "active",
      tasks: [
        {
          id: "resolve",
          label: "Resolve",
          trigger: "manual",
          role: "ai-task",
          tools: ["create_instance"],
        },
      ],
    },
  ],
  initial: "working",
  terminalStates: [],
});

describe("agent-created instances", () => {
  it("an ai-task can graduate a fresh instance via the create_instance tool", async () => {
    let calls = 0;
    const runtime = createFlowRuntime(
      "flow",
      [resolverWorkflow, ticketWorkflow],
      [],
      {
        "ai-task": (ctx) =>
          createAiTaskRunner({
            modelCaller: async (_prompt, _msgs, _tools, _signal) => {
              calls++;
              if (calls === 1) {
                return {
                  content: "graduating",
                  toolCalls: [
                    {
                      id: "c1",
                      name: "create_instance",
                      arguments: JSON.stringify({
                        workflowId: "ticket",
                        instanceState: { title: "Graduated ticket" },
                      }),
                    },
                  ],
                };
              }
              return { content: "done" };
            },
            toolDefinitions: createStandardToolDefinitions(),
            toolExecutors: createStandardToolRegistry(),
            createWorkflowInstance: ctx.createWorkflowInstance,
          }),
      }
    );

    const resolver = runtime.addWorkflowInstance("resolver");
    await resolver.startTask("resolve");

    const tickets = runtime
      .getWorkflowInstanceEntries()
      .filter((entry) => entry.workflowId === "ticket");
    assert.equal(tickets.length, 1);
    assert.deepEqual(tickets[0]?.state.workflowInstanceState, {
      title: "Graduated ticket",
    });
    assert.equal(tickets[0]?.state.currentState, "fog");
  });
});
