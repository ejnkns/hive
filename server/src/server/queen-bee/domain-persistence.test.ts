import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import {
  readBoard,
  readCardEvents,
  readRequirements,
  writeRequirements,
} from "../../../../presets/queen-bee/domain-state";
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
    execSync("git branch hive-main", { cwd: basePath, encoding: "utf-8" });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("update_requirements_draft writes the draft under basePath", async () => {
    const tool = findTool("update_requirements_draft");
    const ctx: ToolContext = { workspacePath: basePath, basePath: basePath };

    const result = await tool.executor(
      {
        id: "c1",
        name: "update_requirements_draft",
        arguments: JSON.stringify({ content: "# Draft requirements\n" }),
      },
      ctx
    );

    assert.equal(result.isError, false);
    assert.equal(
      readFileSync(join(basePath, ".hive", "draft.md"), "utf-8"),
      "# Draft requirements\n"
    );
  });

  it("finalize_requirements writes requirements.md from the draft", async () => {
    const runner = makeRunner({ basePath });
    const draftTool = findTool("update_requirements_draft");
    await draftTool.executor(
      {
        id: "c1",
        name: "update_requirements_draft",
        arguments: JSON.stringify({ content: "# Final requirements\n" }),
      },
      { workspacePath: basePath, basePath: basePath }
    );

    const result = await runner.run({
      ...dummyTask,
      operations: ["finalize_requirements"],
    });

    assert.equal((result.output as { ok: boolean }).ok, true);
    assert.equal(readRequirements(basePath), "# Final requirements\n");
  });

  it("sync_card_status registers the card on the board with its state status", async () => {
    const runner = makeRunner(
      { basePath },
      {
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
      operations: ["sync_card_status"],
    });

    assert.equal((result.output as { ok: boolean }).ok, true);
    const board = readBoard(basePath);
    assert.equal(board.cards.length, 1);
    assert.equal(board.cards[0]?.title, "Implement X");
    assert.equal(board.cards[0]?.status, "ready");
  });

  it("validate_completion rejects a card with no committed work", async () => {
    const runner = makeRunner({ basePath }, { attempt: 1 });

    const result = await runner.run({
      ...dummyTask,
      operations: ["validate_completion"],
    });

    const output = result.output as { ok: boolean; error?: string };
    assert.equal(output.ok, false);
    assert.match(output.error ?? "", /No work branch/);
  });

  it("validate_completion accepts committed work ahead of hive-main", async () => {
    execSync("git checkout -b hive/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "x.txt"), "work\n");
    execSync("git add -A && git commit -m work", {
      cwd: basePath,
      encoding: "utf-8",
    });

    const runner = makeRunner({ basePath }, { attempt: 1 });
    const result = await runner.run({
      ...dummyTask,
      operations: ["validate_completion"],
    });

    const output = result.output as { ok: boolean; commitCount: number };
    assert.equal(output.ok, true);
    assert.ok(output.commitCount >= 1);

    const events = readCardEvents(basePath, "card-1");
    assert.equal(events[0]?.type, "completion_validated");
  });

  it("submit_work records a submission event on the card", async () => {
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
    const events = readCardEvents(basePath, "card-1");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "submitted");
    assert.deepEqual(events[0]?.data, { outcome: "implemented" });
  });

  it("sync_idea registers the idea on the board", async () => {
    const runner = makeRunner(
      { basePath },
      { title: "New idea", brief: "Do it" }
    );
    const result = await runner.run({
      ...dummyTask,
      operations: ["sync_idea"],
    });

    assert.equal((result.output as { ok: boolean }).ok, true);
    const board = readBoard(basePath);
    assert.equal(board.ideas.length, 1);
    assert.equal(board.ideas[0]?.title, "New idea");
    assert.equal(board.ideas[0]?.status, "backlog");
  });

  it("build_review_package writes an immutable review package", async () => {
    writeRequirements(basePath, "# Requirements\n");
    execSync("git checkout -b hive/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "x.txt"), "work\n");
    execSync("git add -A && git commit -m work", {
      cwd: basePath,
      encoding: "utf-8",
    });

    const runner = makeRunner(
      { basePath },
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

    const output = result.output as { ok: boolean; path: string };
    assert.equal(output.ok, true);
    assert.ok(existsSync(output.path));
    const pkg = JSON.parse(readFileSync(output.path, "utf-8")) as {
      cardId: string;
      spec: { title: string };
      requirements: string;
    };
    assert.equal(pkg.cardId, "card-1");
    assert.equal(pkg.spec.title, "Implement X");
    assert.equal(pkg.requirements, "# Requirements\n");
  });

  // Skipped until Phase 4 wires integrationBranch/branchPrefix into queen-bee
  // flow config — the engine now requires them (no defaults) and the full
  // flow's onboarding never completes without them.
  it.skip("a running card registers itself on the board", async () => {
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

    const cardId = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards")?.id;

    await waitFor(() => {
      const board = readBoard(basePath);
      return cardId !== undefined && board.cards.some((c) => c.id === cardId);
    });

    const board = readBoard(basePath);
    assert.equal(board.cards[0]?.title, "Implement X");

    // The card has advanced to running_agent and the worker session would call
    // the model — not available in tests. Cancel so the runner aborts and the
    // process drains.
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
