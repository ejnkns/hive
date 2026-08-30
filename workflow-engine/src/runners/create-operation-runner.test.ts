import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskDefinition } from "../task-runner.ts";
import { createOperationRunner } from "./create-operation-runner.ts";

describe("createOperationRunner", () => {
  const dummyTask: TaskDefinition = {
    id: "test",
    label: "Test",
    role: "operation",
    operations: ["greet", "add"],
  };

  it("executes operations sequentially", async () => {
    const calls: string[] = [];
    const runner = createOperationRunner({
      operations: {
        greet: () => {
          calls.push("greet");
          return { message: "hello" };
        },
        add: () => {
          calls.push("add");
          return { sum: 3 };
        },
      },
    });

    const result = await runner.run(dummyTask);
    assert.deepEqual(calls, ["greet", "add"]);
    assert.deepEqual(result.output, {
      greet: { message: "hello" },
      add: { sum: 3 },
    });
  });

  it("throws for unknown operation", async () => {
    const runner = createOperationRunner({ operations: {} });
    await assert.rejects(
      () => runner.run({ ...dummyTask, operations: ["nonexistent"] }),
      /Unknown operation: nonexistent/
    );
  });

  it("respects cancel between operations", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const firstPromise = new Promise<void>((r) => {
      release = r;
    });

    const runner = createOperationRunner({
      operations: {
        slow: async () => {
          calls.push("slow");
          await firstPromise;
          return {};
        },
        never: () => {
          calls.push("never");
          return {};
        },
      },
    });

    const promise = runner.run({
      ...dummyTask,
      operations: ["slow", "never"],
    });

    runner.cancel();
    release?.();
    await promise;

    assert.deepEqual(calls, ["slow"]);
  });

  it("returns empty for no operations", async () => {
    const runner = createOperationRunner({ operations: {} });
    const result = await runner.run({ ...dummyTask, operations: [] });
    assert.deepEqual(result.output, {});
  });

  it("passes operationInputs as the operation params", async () => {
    const runner = createOperationRunner({
      operations: {
        echo: (_task, params) => ({ seen: params }),
      },
    });

    const result = await runner.run({
      ...dummyTask,
      operations: ["echo"],
      operationInputs: { basePath: "/tmp/repo" },
    });

    assert.deepEqual(result.output, { seen: { basePath: "/tmp/repo" } });
  });

  it("provides the operation context from getContext", async () => {
    const context = {
      flowConfig: () => ({ basePath: "/tmp/repo" }),
      instanceId: "instance-1",
      workflowId: "test-wf",
      currentState: "working",
      workflowInstanceState: () => ({ attempt: 2 }),
      taskOutputs: () => ({}),
      patchWorkflowInstanceState: () => {},
      flowState: () => ({}),
      patchFlowState: () => {},
      workflowInstancesInState: () => [],
      patchInstanceState: () => false,
    };
    const runner = createOperationRunner({
      getContext: () => context,
      operations: {
        read: (_task, _params, ctx) => ({
          basePath: ctx.flowConfig().basePath,
          cardId: ctx.instanceId,
          attempt: ctx.workflowInstanceState().attempt,
        }),
      },
    });

    const result = await runner.run({ ...dummyTask, operations: ["read"] });

    assert.deepEqual(result.output, {
      basePath: "/tmp/repo",
      cardId: "instance-1",
      attempt: 2,
    });
  });

  it("keys multi-operation task results by operation name", async () => {
    const runner = createOperationRunner({
      operations: {
        first: () => ({ n: 1 }),
        second: () => ({ n: 2 }),
      },
    });

    const result = await runner.run({
      ...dummyTask,
      operations: ["first", "second"],
    });

    assert.deepEqual(result.output, { first: { n: 1 }, second: { n: 2 } });
  });
});
