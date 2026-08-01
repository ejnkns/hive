import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskRunnerContext, Tool } from "workflow-engine/runners";
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
    workflowInstanceState: {},
    patchWorkflowInstanceState: () => {},
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

  it("prepare_worktree derives card and attempt from instance state", async () => {
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
          workflowInstanceState: { projectId: "proj-1", attempt: 2 },
        })
      )
      .run(task);

    const output = result.output as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.ok(
      existsSync(join(workspacesBasePath, "proj-1", "instance-1", "attempt-2"))
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
