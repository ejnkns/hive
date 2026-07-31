import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createFlowRuntime,
  type FlowPersistence,
  type FlowRuntimeEvent,
} from "./create-flow-runtime";
import type { TaskDefinition, TaskRunner } from "./task-runner";
import type { FlowEdge } from "./workflow-types";
import { defineWorkflow } from "./workflow-types";

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

const otherWorkflow = defineWorkflow({
  id: "other",
  label: "Other",
  taskOutputs: {} as Record<string, never>,
  states: [{ id: "init", label: "Init" }],
  initial: "init",
  terminalStates: ["init"],
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
          repoPath: "/tmp/repo",
        }
      );
      assert.deepEqual(runtime.getFlowConfig(), { repoPath: "/tmp/repo" });
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
      const controller = runtime.addWorkflowInstance("source");
      assert.equal(created.length, 1);
      assert.equal(created[0]!.workflowId, "source");
      assert.ok(created[0]!.instanceId);
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
      assert.equal(runtime.getWorkflowInstance(instanceId!), controller);
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
      assert.equal(runtime.workflowInstances[0]!.currentState, "idle");
      assert.equal(runtime.workflowInstances[1]!.currentState, "idle");
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
        { "ai-task": runner }
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
        { "ai-task": runner }
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));
      runner.complete({ result: "hello" });
      await new Promise((r) => setTimeout(r, 0));

      const targetInstances = runtime.workflowInstancesInState("ready");
      assert.equal(targetInstances.length, 1);
      assert.equal(
        targetInstances[0]!.workflowInstanceState.inherited,
        "hello"
      );
      assert.deepEqual(targetInstances[0]!.workflowInstanceState.dependsOn, [
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
        { "ai-task": runner }
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
        { "ai-task": runner }
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
        { "ai-task": runner }
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
        { "ai-task": runner },
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
        "ai-task": runner,
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
        { "ai-task": runner },
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
        "ai-task": runner,
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
        saveRunningTaskContext() {},
        loadFlow() {
          return null;
        },
        loadAllFlows() {
          return [];
        },
      };

      const runtime = createFlowRuntime(
        "test-flow",
        [sourceWorkflow],
        [],
        {},
        { repoPath: "/tmp" },
        { count: 0 },
        persistence
      );

      runtime.patchFlowState({ count: 1 });
      assert.equal(saved.length, 1);
      assert.equal(saved[0]!.flowId, "test-flow");
      const savedState = saved[0]!.state;
      assert.ok(
        savedState !== null &&
          typeof savedState === "object" &&
          "count" in savedState
      );
      assert.equal(savedState["count"], 1);
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
        saveRunningTaskContext() {},
        loadFlow() {
          return null;
        },
        loadAllFlows() {
          return [];
        },
      };

      const runner = new MockRunner();
      const runtime = createFlowRuntime(
        "test-flow",
        [sourceWorkflow],
        [],
        { "ai-task": runner },
        {},
        {},
        persistence
      );

      const controller = runtime.addWorkflowInstance("source");
      controller.dispatchAction("start");
      await new Promise((r) => setTimeout(r, 0));

      // state_changed emitted for transition idle → working
      assert.ok(saved.length >= 1);
      assert.equal(saved[0]!.flowId, "test-flow");
    });
  });
});

function readOutputResult(output: unknown): unknown {
  if (output === null || typeof output !== "object") return undefined;
  return "result" in output ? output["result"] : undefined;
}
