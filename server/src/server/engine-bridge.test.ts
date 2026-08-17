import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskRunnerContext, Tool } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { createEngineRunners } from "./engine-bridge.ts";

const domainTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "domain_helper",
      description: "Test domain tool",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  executor: async (call) => ({
    toolCallId: call.id,
    content: "ok",
    isError: false,
  }),
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-engine-bridge-"));
  tempDirs.push(dir);
  return dir;
}

function makeContext(
  overrides: Partial<TaskRunnerContext> = {}
): TaskRunnerContext {
  return {
    flowConfig: {},
    patchFlowConfig: () => {},
    instanceId: "instance-1",
    workflowId: "test-wf",
    currentState: "ready",
    workflowInstanceState: () => ({}),
    patchWorkflowInstanceState: () => {},
    taskOutputs: {},
    flowState: () => ({}),
    patchFlowState: () => {},
    patchRunningTaskMessages: () => {},
    patchRunningTaskStatus: () => {},
    createWorkflowInstance: () => ({ id: "new-instance" }),
    workflowInstancesInState: () => [],
    patchSiblingInstanceState: () => false,
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createEngineRunners", () => {
  it("merges domain tools on top of the infrastructure registry", () => {
    const runners = createEngineRunners({ tools: [domainTool] });

    assert.ok(runners.toolDefinitions.domain_helper);
    assert.ok(runners.toolExecutors.domain_helper);
    assert.ok(runners.toolDefinitions.read_file);
    assert.ok(runners.toolDefinitions.git_diff);
  });

  it("a domain tool overrides an infrastructure tool of the same name", async () => {
    // The modular web story: a flow supplies its own web_fetch and the
    // engine's built-in executor is replaced by name.
    const customWebFetch: Tool = {
      definition: {
        type: "function",
        function: {
          name: "web_fetch",
          description: "Custom fetch",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      executor: async (call) => ({
        toolCallId: call.id,
        content: "custom web fetch ran",
        isError: false,
      }),
    };
    const runners = createEngineRunners({ tools: [customWebFetch] });

    assert.ok(
      runners.toolExecutors.web_fetch,
      "web_fetch is offered (custom or built-in)"
    );
    const result = await runners.toolExecutors.web_fetch(
      { id: "c1", name: "web_fetch", arguments: "{}" },
      { workspacePath: "/tmp" }
    );
    assert.equal(result.content, "custom web fetch ran");
  });

  it("executes domain operations through the operation runner", async () => {
    const runners = createEngineRunners({
      operations: {
        validate_completion: () => ({ ok: true }),
        build_review_package: () => ({ packageId: "pkg-1" }),
      },
    });

    const task: TaskDefinition = {
      id: "validate",
      label: "Validate",
      role: "operation",
      operations: ["validate_completion", "build_review_package"],
    };
    const result = await runners.operationRunner(makeContext()).run(task);

    assert.deepEqual(result.output, {
      validate_completion: { ok: true },
      build_review_package: { packageId: "pkg-1" },
    });
  });

  it("threads the cross-instance write and workflow-filtered query into the operation context (E1/E6)", async () => {
    const calls: Array<{
      kind: "patch" | "query";
      instanceId?: string;
      patch?: Record<string, unknown>;
      query?: unknown;
    }> = [];
    const runners = createEngineRunners({
      operations: {
        cross: (_task, _params, ctx) => {
          const ok = ctx.patchInstanceState("sibling-1", {
            category: "infra",
          });
          const all = ctx.workflowInstancesInState();
          const filtered = ctx.workflowInstancesInState("ideas");
          calls.push({ kind: "patch", instanceId: "sibling-1" });
          calls.push({ kind: "query", query: { all, filtered } });
          return { ok, count: all.length, filteredCount: filtered.length };
        },
      },
    });

    const task: TaskDefinition = {
      id: "cross",
      label: "Cross",
      role: "operation",
      operations: ["cross"],
    };
    const patched: Array<Record<string, unknown>> = [];
    const result = await runners
      .operationRunner(
        makeContext({
          patchSiblingInstanceState: (instanceId, patch) => {
            if (instanceId !== "sibling-1") return false;
            patched.push(patch);
            return true;
          },
          workflowInstancesInState: (workflowId) => {
            // The engine-bridge passes the context's query through unchanged.
            const instances = [
              { workflowId: "ideas", id: "i1" },
              { workflowId: "imports", id: "i2" },
            ];
            if (workflowId !== undefined) {
              return instances.filter(
                (i) => i.workflowId === workflowId
              ) as never;
            }
            return instances as never;
          },
        })
      )
      .run(task);

    const output = result.output as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.equal(output.count, 2);
    assert.equal(output.filteredCount, 1);
    assert.deepEqual(patched, [{ category: "infra" }]);
    assert.equal(calls[0]?.kind, "patch");
    assert.equal(calls[1]?.kind, "query");
  });

  it("prepare_worktree prepares a sandbox workspace without a repo", async () => {
    const workspacesBasePath = tempDir();
    const runners = createEngineRunners();

    const task: TaskDefinition = {
      id: "prepare",
      label: "Prepare",
      role: "operation",
      operations: ["prepare_worktree"],
    };
    const result = await runners
      .operationRunner(
        makeContext({
          flowConfig: { workspacesBasePath },
          instanceId: "card-1",
          workflowId: "cards",
        })
      )
      .run(task);

    const output = result.output as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.ok(
      existsSync(join(workspacesBasePath, "cards", "card-1", "attempt-1"))
    );
  });

  it("prepare_worktree derives the workspace path from the workflow id", async () => {
    const workspacesBasePath = tempDir();
    const runners = createEngineRunners();

    const task: TaskDefinition = {
      id: "prepare",
      label: "Prepare",
      role: "operation",
      operations: ["prepare_worktree"],
    };
    const result = await runners
      .operationRunner(
        makeContext({
          flowConfig: { workspacesBasePath },
          workflowId: "cards",
          workflowInstanceState: () => ({ attempt: 2 }),
        })
      )
      .run(task);

    const output = result.output as Record<string, unknown>;
    assert.equal(output.ok, true);
    // The project/workspace namespace comes from the engine (ctx.workflowId) —
    // the former projectId instance-state fallback was removed as a dead field.
    assert.ok(
      existsSync(join(workspacesBasePath, "cards", "instance-1", "attempt-2"))
    );
  });

  it("patch_flow_config writes inputs into flow config", async () => {
    const config: Record<string, unknown> = {
      basePath: "/tmp/repo",
      name: "Project",
      targetBranch: "main",
    };
    const runners = createEngineRunners();

    const task: TaskDefinition = {
      id: "bind",
      label: "Bind",
      role: "operation",
      operations: ["patch_flow_config"],
      operationInputs: {
        basePath: "@flow:basePath",
        targetBranch: "@flow:targetBranch",
        name: "@flow:name",
        maxConcurrentWorkers: 5,
      },
    };
    const result = await runners
      .operationRunner(
        makeContext({
          flowConfig: config,
          patchFlowConfig: (patch) => Object.assign(config, patch),
        })
      )
      .run(task);

    const output = result.output as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.equal(config.name, "Project");
    assert.equal(config.basePath, "/tmp/repo");
    assert.equal(config.targetBranch, "main");
    assert.equal(config.maxConcurrentWorkers, 5);
  });
});
