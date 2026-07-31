import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowRuntimeAPI } from "workflow-engine/create-flow-runtime";
import type { Tool } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import { createEngineRunners } from "./engine-bridge";

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

describe("createEngineRunners", () => {
  it("merges domain tools on top of the infrastructure registry", () => {
    const runners = createEngineRunners({ tools: [domainTool] });

    assert.ok(runners.toolDefinitions.domain_helper);
    assert.ok(runners.toolExecutors.domain_helper);
    assert.ok(runners.toolDefinitions.read_file);
    assert.ok(runners.toolDefinitions.git_diff);
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
    const result = await runners.operationRunner().run(task);

    assert.deepEqual(result.output, {
      validate_completion: { ok: true },
      build_review_package: { packageId: "pkg-1" },
    });
  });

  it("always ships prepare_worktree with or without domain operations", async () => {
    const runners = createEngineRunners();

    const task: TaskDefinition = {
      id: "prepare",
      label: "Prepare",
      role: "operation",
      operations: ["prepare_worktree"],
    };

    // prepare_worktree is wired to the engine implementation, not missing from
    // the registry — an unwired name would reject with "Unknown operation".
    await assert.rejects(
      () => runners.operationRunner().run(task),
      (err: unknown) =>
        !(err instanceof Error) || !err.message.includes("Unknown operation")
    );
  });

  it("patch_flow_config writes inputs into the bound runtime's config", async () => {
    let config: Record<string, unknown> = {
      repoPath: "/tmp/repo",
      name: "Project",
      targetBranch: "main",
    };
    const runtime = {
      getFlowConfig: () => config,
      patchFlowConfig: (patch: Record<string, unknown>) => {
        config = { ...config, ...patch };
      },
    } as unknown as FlowRuntimeAPI<
      Record<string, unknown>,
      Record<string, unknown>
    >;

    const runners = createEngineRunners();
    runners.bindRuntime(runtime);

    const task: TaskDefinition = {
      id: "bind",
      label: "Bind",
      role: "operation",
      operations: ["patch_flow_config"],
      operationInputs: {
        repoPath: "@flow:repoPath",
        targetBranch: "@flow:targetBranch",
        name: "@flow:name",
        maxConcurrentWorkers: 5,
      },
    };

    const result = await runners.operationRunner().run(task);
    const output = result.output as Record<string, unknown>;

    assert.equal(output.ok, true);
    assert.equal(config.name, "Project");
    assert.equal(config.repoPath, "/tmp/repo");
    assert.equal(config.targetBranch, "main");
    assert.equal(config.maxConcurrentWorkers, 5);
  });

  it("patch_flow_config resolves @flow: refs from the current config", async () => {
    let config: Record<string, unknown> = { repoPath: "/tmp/repo" };
    const runtime = {
      getFlowConfig: () => config,
      patchFlowConfig: (patch: Record<string, unknown>) => {
        config = { ...config, ...patch };
      },
    } as unknown as FlowRuntimeAPI<
      Record<string, unknown>,
      Record<string, unknown>
    >;

    const runners = createEngineRunners();
    runners.bindRuntime(runtime);

    const task: TaskDefinition = {
      id: "bind",
      label: "Bind",
      role: "operation",
      operations: ["patch_flow_config"],
      operationInputs: { repoPath: "@flow:repoPath" },
    };

    await runners.operationRunner().run(task);

    assert.equal(config.repoPath, "/tmp/repo");
  });

  it("operations that touch context reject before bindRuntime", async () => {
    const runners = createEngineRunners();

    const task: TaskDefinition = {
      id: "bind",
      label: "Bind",
      role: "operation",
      operations: ["patch_flow_config"],
      operationInputs: {},
    };

    await assert.rejects(
      () => runners.operationRunner().run(task),
      /not bound to a runtime/
    );
  });
});
