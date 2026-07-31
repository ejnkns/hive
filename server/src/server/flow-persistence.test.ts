import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFlowPersistence } from "./flow-persistence";

const TEST_DIR = join("/tmp", "hive-flow-persistence-test", randomUUID());

function tempDir(name: string): string {
  return join(TEST_DIR, name);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("FlowPersistence", () => {
  describe("saveFlow / loadFlow", () => {
    it("saves and loads flow config and state", () => {
      const dir = tempDir("save-load-flow");
      const p = createFlowPersistence(dir);

      p.saveFlow("test-flow", { repoPath: "/tmp/repo" }, { count: 1 });

      const result = p.loadFlow("test-flow");
      assert.ok(result);
      assert.deepEqual(result.config as Record<string, unknown>, {
        repoPath: "/tmp/repo",
      });
      assert.deepEqual(result.state as Record<string, unknown>, { count: 1 });
      assert.deepEqual(result.instances, []);
    });

    it("returns null for unknown flow", () => {
      const dir = tempDir("unknown-flow");
      const p = createFlowPersistence(dir);
      assert.equal(p.loadFlow("nonexistent"), null);
    });

    it("overwrites flow file on subsequent saves", () => {
      const dir = tempDir("overwrite-flow");
      const p = createFlowPersistence(dir);

      p.saveFlow("test-flow", { a: 1 }, { x: 10 });
      p.saveFlow("test-flow", { a: 2 }, { x: 20 });

      const result = p.loadFlow("test-flow");
      assert.ok(result);
      assert.equal((result.config as Record<string, unknown>).a, 2);
      assert.equal((result.state as Record<string, unknown>).x, 20);
    });
  });

  describe("saveInstance / loadFlow instances", () => {
    it("saves and loads instances with workflowId", () => {
      const dir = tempDir("save-load-instance");
      const p = createFlowPersistence(dir);

      p.saveFlow("test-flow", {}, {});
      p.saveInstance("test-flow", "inst-1", "cards", {
        currentState: "ready",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: {
          projectId: "p1",
          repoPath: "/tmp",
          attempt: 0,
          validationFailures: 0,
        },
        history: [],
      });

      const result = p.loadFlow("test-flow");
      assert.ok(result);
      assert.equal(result.instances.length, 1);
      assert.equal(result.instances[0]!.workflowId, "cards");
      assert.equal(result.instances[0]!.state.currentState, "ready");
      assert.equal(
        result.instances[0]!.state.workflowInstanceState.projectId,
        "p1"
      );
    });

    it("loads multiple instances", () => {
      const dir = tempDir("multiple-instances");
      const p = createFlowPersistence(dir);

      p.saveFlow("test-flow", {}, {});
      p.saveInstance("test-flow", "a", "cards", {
        currentState: "ready",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: {},
        history: [],
      });
      p.saveInstance("test-flow", "b", "ideas", {
        currentState: "backlog",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: {},
        history: [],
      });

      const result = p.loadFlow("test-flow");
      assert.ok(result);
      assert.equal(result.instances.length, 2);
    });
  });

  describe("saveRunningTaskContext", () => {
    it("persists running task context separately", () => {
      const dir = tempDir("save-context");
      const p = createFlowPersistence(dir);

      p.saveFlow("test-flow", {}, {});
      p.saveInstance("test-flow", "inst-1", "cards", {
        currentState: "running_agent",
        taskOutputs: {},
        hasRunningTask: true,
        runningTaskId: "run_agent",
        runningTaskContext: {
          role: "ai-task",
          messages: [{ role: "user", content: "hello" }],
        },
        workflowInstanceState: {},
        history: [],
      });

      // Update context (e.g., new message)
      p.saveRunningTaskContext("test-flow", "inst-1", {
        role: "ai-task",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
        ],
      });

      const result = p.loadFlow("test-flow");
      assert.ok(result);
      assert.equal(result.instances.length, 1);
      const runningCtx = result.instances[0]!.state.runningTaskContext;
      assert.ok(runningCtx !== null);
      if (runningCtx.role !== "ai-task" && runningCtx.role !== "ai-chat") {
        assert.fail("expected a message-carrying running task context");
      }
      assert.equal(runningCtx.messages.length, 2);
    });
  });

  describe("loadAllFlows", () => {
    it("returns empty array when flows dir is empty", () => {
      const dir = tempDir("empty");
      const p = createFlowPersistence(dir);
      assert.deepEqual(p.loadAllFlows(), []);
    });

    it("loads all flows that have flow.json", () => {
      const dir = tempDir("all-flows");
      const p = createFlowPersistence(dir);

      p.saveFlow("flow-a", { a: 1 }, {});
      p.saveFlow("flow-b", { b: 2 }, {});
      p.saveInstance("flow-b", "i1", "cards", {
        currentState: "ready",
        taskOutputs: {},
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: {},
        history: [],
      });

      const all = p.loadAllFlows();
      assert.equal(all.length, 2);

      const a = all.find((f) => f.flowId === "flow-a");
      const b = all.find((f) => f.flowId === "flow-b");
      assert.ok(a);
      assert.ok(b);
      assert.equal((a.config as Record<string, unknown>).a, 1);
      assert.equal(b.instances.length, 1);
    });

    it("skips directories without flow.json", () => {
      const dir = tempDir("skip-dir");
      mkdirSync(join(dir, "no-flow"), { recursive: true });
      writeFileSync(join(dir, "no-flow", "some-file.txt"), "junk");

      const p = createFlowPersistence(dir);
      assert.deepEqual(p.loadAllFlows(), []);
    });
  });

  describe("atomic writes", () => {
    it("writes atomically (tmp + rename)", () => {
      const dir = tempDir("atomic");
      const p = createFlowPersistence(dir);

      p.saveFlow("test", {}, { key: "val" });

      const flowDir = join(dir, encodeURIComponent("test"));
      const files = readdirSync(flowDir);
      // Should NOT contain .tmp files
      assert.ok(!files.some((f) => f.endsWith(".tmp")));
      assert.ok(files.includes("flow.json"));
    });
  });
});
