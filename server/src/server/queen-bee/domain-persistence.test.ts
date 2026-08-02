import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createOperationRunner,
  type OperationContext,
  type Tool,
  type ToolContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { ReviewPackage } from "../../../../presets/queen-bee/domain-state";
import { queenBeeFlow } from "../../../../presets/queen-bee/flow";
import { queenBeeOperations } from "../../../../presets/queen-bee/operations";
import { queenBeeTools } from "../../../../presets/queen-bee/tools";
import { registerFlowDefinition } from "../flow-definitions";
import { createFlowPersistence } from "../flow-persistence";
import {
  createFlow,
  getFlowPersistence,
  getFlowRuntime,
  setFlowPersistence,
} from "../flow-registry";

const dummyTask: TaskDefinition = { id: "t", label: "T", role: "operation" };

const queenBeeConfig = {
  integrationBranch: "queen-bee-main",
  branchPrefix: "queen-bee/",
  domainDir: ".queen-bee",
};

function makeRunner(
  flowConfig: Record<string, unknown>,
  instanceState: Record<string, unknown> = {}
) {
  return createOperationRunner({
    getContext: (): OperationContext => ({
      flowConfig: () => flowConfig,
      patchFlowConfig: () => {},
      instanceId: "card-1",
      workflowId: "cards",
      currentState: "ready",
      workflowInstanceState: () => instanceState,
    }),
    operations: queenBeeOperations,
  });
}

function findTool(name: string): Tool {
  const tool = queenBeeTools.find((t) => t.definition.function.name === name);
  assert.ok(tool, `tool ${name} not found`);
  return tool;
}

describe("queen-bee domain persistence", () => {
  let root: string;
  let basePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-domain-persist-"));
    basePath = join(root, "repo");
    mkdirSync(basePath);
    execSync("git init -b main", { cwd: basePath, encoding: "utf-8" });
    execSync("git config user.email test@example.com", {
      cwd: basePath,
      encoding: "utf-8",
    });
    execSync("git config user.name Test", { cwd: basePath, encoding: "utf-8" });
    execSync("git commit --allow-empty -m initial", {
      cwd: basePath,
      encoding: "utf-8",
    });
    execSync("git branch queen-bee-main", {
      cwd: basePath,
      encoding: "utf-8",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("update_requirements_draft records the draft in instance state", async () => {
    const tool = findTool("update_requirements_draft");
    const patches: Array<Record<string, unknown>> = [];
    const ctx: ToolContext = {
      workspacePath: basePath,
      basePath,
      patchWorkflowInstanceState: (patch) => patches.push(patch),
    };

    const result = await tool.executor(
      {
        id: "c1",
        name: "update_requirements_draft",
        arguments: JSON.stringify({ content: "# Draft requirements\n" }),
      },
      ctx
    );

    assert.equal(result.isError, false);
    assert.deepEqual(patches, [
      { requirementsDraft: "# Draft requirements\n" },
    ]);
    assert.equal(existsSync(join(basePath, ".queen-bee", "draft.md")), false);
  });

  it("finalize_requirements returns the requirements text from the session state", async () => {
    const runner = makeRunner(
      { ...queenBeeConfig, basePath },
      { requirementsDraft: "# Final requirements\n" }
    );

    const result = await runner.run({
      ...dummyTask,
      operations: ["finalize_requirements"],
    });

    assert.equal(result.output, "# Final requirements\n");
  });

  it("finalize_requirements throws without a draft", async () => {
    const runner = makeRunner({ ...queenBeeConfig, basePath });
    await assert.rejects(
      runner.run({ ...dummyTask, operations: ["finalize_requirements"] }),
      /No requirements draft/
    );
  });

  it("validate_completion throws for a card with no committed work", async () => {
    const runner = makeRunner({ ...queenBeeConfig, basePath }, { attempt: 1 });

    await assert.rejects(
      runner.run({ ...dummyTask, operations: ["validate_completion"] }),
      /No work branch/
    );
  });

  it("validate_completion accepts committed work ahead of the integration branch", async () => {
    execSync("git checkout -b queen-bee/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "x.txt"), "work\n");
    execSync("git add -A && git commit -m work", {
      cwd: basePath,
      encoding: "utf-8",
    });

    const runner = makeRunner({ ...queenBeeConfig, basePath }, { attempt: 1 });
    const result = await runner.run({
      ...dummyTask,
      operations: ["validate_completion"],
    });

    const output = result.output as { ok: boolean; commitCount: number };
    assert.equal(output.ok, true);
    assert.ok(output.commitCount >= 1);
    assert.equal(existsSync(join(basePath, ".queen-bee", "cards")), false);
  });

  it("submit_work acknowledges the signal without writing card events", async () => {
    const tool = findTool("submit_work");
    const result = await tool.executor(
      {
        id: "c1",
        name: "submit_work",
        arguments: JSON.stringify({ outcome: "implemented" }),
      },
      { workspacePath: basePath, basePath: basePath, instanceId: "card-1" }
    );

    assert.equal(result.isError, false);
    assert.match(result.content, /submitted/);
    assert.equal(existsSync(join(basePath, ".queen-bee", "cards")), false);
  });

  it("build_review_package returns the review package object", async () => {
    const flowDir = join(basePath, ".queen-bee");
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(join(flowDir, "requirements.md"), "# Requirements\n");
    execSync("git checkout -b queen-bee/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "x.txt"), "work\n");
    execSync("git add -A && git commit -m work", {
      cwd: basePath,
      encoding: "utf-8",
    });

    const runner = makeRunner(
      { ...queenBeeConfig, basePath },
      {
        attempt: 1,
        cardSpec: {
          title: "Implement X",
          description: "Do the thing",
          acceptanceCriteria: ["works"],
          dependsOn: [],
        },
      }
    );
    const result = await runner.run({
      ...dummyTask,
      operations: ["build_review_package"],
    });

    const pkg = result.output as ReviewPackage;
    assert.equal(pkg.cardId, "card-1");
    assert.equal(pkg.spec.title, "Implement X");
    assert.equal(pkg.requirements, "# Requirements\n");
    assert.ok(pkg.packageId.length > 0);
  });

  it("a running card advances through the cards workflow", async () => {
    const workspacesBasePath = join(root, "workspaces");
    setFlowPersistence(createFlowPersistence(join(root, "hive")));
    registerFlowDefinition(queenBeeFlow);

    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("project", "queen-bee", persistence, {
      basePath,
      name: "Project",
      workspacesBasePath,
    });

    const runtime = getFlowRuntime("project");
    assert.ok(runtime);
    await waitFor(() => {
      const onboarding = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "onboarding");
      return onboarding?.state.currentState === "complete";
    });

    const controller = runtime.addWorkflowInstance("cards", {
      workflowInstanceState: {
        attempt: 1,
        cardSpec: {
          title: "Implement X",
          description: "Do the thing",
          acceptanceCriteria: ["works"],
          dependsOn: [],
        },
      },
    });
    controller.dispatchAction("run");

    // The worker prep is the config-driven git path: a worktree on the
    // integration branch with a queen-bee/ feature branch. running_agent is
    // transient (the worker session would call the model, unavailable here),
    // so assert the prep itself succeeded.
    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.taskOutputs.prepareWorktree?.status === "success";
    });

    // No board file is written; the card's state IS its position.
    assert.equal(existsSync(join(basePath, ".queen-bee", "board.json")), false);

    // The worker session would call the model — not available in tests. Cancel
    // so the runner aborts and the process drains.
    controller.cancel();
  });
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
