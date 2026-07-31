import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
