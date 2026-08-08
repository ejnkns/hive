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
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import {
  type AiChatModelCaller,
  type AiTaskModelCaller,
  createAiChatRunner,
  createAiTaskRunner,
  createOperationRunner,
  type OperationContext,
  type TaskRunnerContext,
  type Tool,
  type ToolContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { ReviewPackage } from "../../../../../presets/queen-bee/cards-workflow";
import {
  queenBeeFlow,
  queenBeeOperations,
} from "../../../../../presets/queen-bee/flow";
import { queenBeeTools } from "../../../../../presets/queen-bee/tools";
import { createEngineRunners } from "../../engine-bridge";
import { registerFlowDefinition } from "../../flow-definitions";
import { createFlowPersistence, type FlowStore } from "../../flow-persistence";
import {
  createFlow,
  getFlowPersistence,
  getFlowRuntime,
  rehydrateFlow,
  setFlowPersistence,
} from "../../flow-registry";

const dummyTask: TaskDefinition = { id: "t", label: "T", role: "operation" };

const queenBeeConfig = {
  integrationBranch: "queen-bee-main",
  branchPrefix: "queen-bee/",
  domainDir: ".queen-bee",
};

function makeEngineRunner(
  flowConfig: Record<string, unknown>,
  instanceState: Record<string, unknown> = {}
) {
  const baseRunners = createEngineRunners({ tools: [], operations: {} });
  return baseRunners.operationRunner({
    flowConfig,
    patchFlowConfig: () => {},
    instanceId: "card-1",
    workflowId: "cards",
    currentState: "ready",
    workflowInstanceState: instanceState,
    taskOutputs: {},
    patchWorkflowInstanceState: (patch: Record<string, unknown>) =>
      Object.assign(instanceState, patch),
    workflowInstancesInState: () => [],
  } as unknown as TaskRunnerContext);
}

function makeRunner(
  flowConfig: Record<string, unknown>,
  instanceState: Record<string, unknown> = {},
  taskOutputs: Record<string, unknown> = {}
) {
  return createOperationRunner({
    getContext: (): OperationContext => ({
      flowConfig: () => flowConfig,
      patchFlowConfig: () => {},
      instanceId: "card-1",
      workflowId: "cards",
      currentState: "ready",
      workflowInstanceState: () => instanceState,
      taskOutputs: () => taskOutputs,
      patchWorkflowInstanceState: (patch) =>
        Object.assign(instanceState, patch),
      workflowInstancesInState: () => [],
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

  it("finalize_requirements recovers the draft from the session's update_requirements_draft tool calls", async () => {
    const runner = makeRunner(
      { ...queenBeeConfig, basePath },
      {},
      {
        draft: {
          status: "success",
          output: {
            content: "Thanks — here's the structured requirements document.",
            messages: [
              {
                role: "assistant",
                content: "Drafting",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: "update_requirements_draft",
                      arguments: JSON.stringify({
                        content: "# Structured requirements\n",
                      }),
                    },
                  },
                ],
              },
              {
                role: "tool",
                content: "Requirements draft updated",
                tool_call_id: "c1",
              },
            ],
          },
        },
      }
    );

    const result = await runner.run({
      ...dummyTask,
      operations: ["finalize_requirements"],
    });

    assert.equal(result.output, "# Structured requirements\n");
  });

  it("finalize_requirements ignores the agent's chat reply and throws when no structured draft was recorded", async () => {
    const runner = makeRunner(
      { ...queenBeeConfig, basePath },
      {},
      {
        draft: {
          status: "success",
          output: {
            content: "Thanks — here's the structured requirements document.",
            messages: [],
          },
        },
      }
    );

    await assert.rejects(
      runner.run({ ...dummyTask, operations: ["finalize_requirements"] }),
      /No requirements draft/
    );
  });

  it("verify_workspace (committed) throws when the branch has no work", async () => {
    execSync("git checkout -b queen-bee/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    const runner = makeEngineRunner(
      { ...queenBeeConfig, basePath },
      { worktreePath: basePath, branchName: "queen-bee/card-1/attempt-1" }
    );

    await assert.rejects(
      runner.run({
        ...dummyTask,
        operations: ["verify_workspace"],
        operationInputs: { require: "committed" },
      }),
      /No committed work/
    );
  });

  it("verify_workspace (committed) accepts committed work ahead of the integration branch", async () => {
    execSync("git checkout -b queen-bee/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "x.txt"), "work\n");
    execSync("git add -A && git commit -m work", {
      cwd: basePath,
      encoding: "utf-8",
    });
    const runner = makeEngineRunner(
      { ...queenBeeConfig, basePath },
      { worktreePath: basePath, branchName: "queen-bee/card-1/attempt-1" }
    );

    const result = await runner.run({
      ...dummyTask,
      operations: ["verify_workspace"],
      operationInputs: { require: "committed" },
    });

    const output = result.output as { ok: boolean; commitCount: number };
    assert.equal(output.ok, true);
    assert.ok(output.commitCount >= 1);
  });

  it("verify_workspace (changes) accepts uncommitted work and rejects a clean workspace", async () => {
    execSync("git checkout -b queen-bee/card-1/attempt-1", {
      cwd: basePath,
      encoding: "utf-8",
    });
    const clean = makeEngineRunner(
      { ...queenBeeConfig, basePath },
      { worktreePath: basePath, branchName: "queen-bee/card-1/attempt-1" }
    );
    await assert.rejects(
      clean.run({
        ...dummyTask,
        operations: ["verify_workspace"],
        operationInputs: { require: "changes" },
      }),
      /No changes/
    );

    writeFileSync(join(basePath, "dirty.txt"), "wip\n");
    const dirty = makeEngineRunner(
      { ...queenBeeConfig, basePath },
      { worktreePath: basePath, branchName: "queen-bee/card-1/attempt-1" }
    );
    const result = await dirty.run({
      ...dummyTask,
      operations: ["verify_workspace"],
      operationInputs: { require: "changes" },
    });
    const output = result.output as { ok: boolean };
    assert.equal(output.ok, true);
  });

  it("verify_workspace (none) passes without any workspace", async () => {
    const runner = makeEngineRunner({ ...queenBeeConfig, basePath }, {});
    const result = await runner.run({
      ...dummyTask,
      operations: ["verify_workspace"],
      operationInputs: { require: "none" },
    });
    assert.equal((result.output as { ok: boolean }).ok, true);
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

  it("check_review_freshness marks a package built at the live head as fresh", async () => {
    const reviewsDir = join(basePath, ".queen-bee", "reviews");
    mkdirSync(reviewsDir, { recursive: true });
    const head = execSync("git rev-parse queen-bee-main", {
      cwd: basePath,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(reviewsDir, "card-1-1.json"),
      JSON.stringify({ cardId: "card-1", attempt: 1, baseCommit: head }),
      "utf-8"
    );

    const instanceState: Record<string, unknown> = { attempt: 1 };
    const runner = makeRunner({ ...queenBeeConfig, basePath }, instanceState);
    const result = await runner.run({
      ...dummyTask,
      operations: ["check_review_freshness"],
    });

    const output = result.output as { ok: boolean; reviewIsStale: boolean };
    assert.equal(output.ok, true);
    assert.equal(output.reviewIsStale, false);
    assert.equal(instanceState.reviewIsStale, false);
  });

  it("check_review_freshness marks a package stale when the integration branch moved", async () => {
    const reviewsDir = join(basePath, ".queen-bee", "reviews");
    mkdirSync(reviewsDir, { recursive: true });
    const head = execSync("git rev-parse queen-bee-main", {
      cwd: basePath,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(reviewsDir, "card-1-1.json"),
      JSON.stringify({ cardId: "card-1", attempt: 1, baseCommit: head }),
      "utf-8"
    );
    execSync("git checkout queen-bee-main", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "later.txt"), "later\n");
    execSync("git add -A && git commit -m later", {
      cwd: basePath,
      encoding: "utf-8",
    });

    const instanceState: Record<string, unknown> = { attempt: 1 };
    const runner = makeRunner({ ...queenBeeConfig, basePath }, instanceState);
    const result = await runner.run({
      ...dummyTask,
      operations: ["check_review_freshness"],
    });

    const output = result.output as { ok: boolean; reviewIsStale: boolean };
    assert.equal(output.ok, true);
    assert.equal(output.reviewIsStale, true);
    assert.equal(instanceState.reviewIsStale, true);
  });

  it("check_review_freshness throws without a review package", async () => {
    const runner = makeRunner({ ...queenBeeConfig, basePath }, { attempt: 1 });
    await assert.rejects(
      runner.run({ ...dummyTask, operations: ["check_review_freshness"] }),
      /No review package/
    );
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

  it("sends a card to unfulfillable after repeated validation failures instead of looping", async () => {
    const workspacesBasePath = join(root, "workspaces");
    // A worker that submits without committing — the "work already done on the
    // shared base" scenario — must not loop forever: each validation failure
    // records a strike and the retry guard trips at 3, sending the card to
    // unfulfillable for coordinator analysis + human remediation.
    const lazyWorker = (): AiChatModelCaller => async () => ({
      content: "Nothing to change",
      toolCalls: [
        {
          id: "s1",
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    });
    const calmReviewer = (): AiTaskModelCaller => async () => ({
      content: "ok",
      toolCalls: [],
    });

    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: lazyWorker(),
      reviewerCaller: calmReviewer(),
    });

    const controller = runtime.addWorkflowInstance("cards", {
      workflowInstanceState: {
        attempt: 1,
        cardSpec: {
          title: "Already implemented",
          description: "",
          acceptanceCriteria: ["works"],
          dependsOn: [],
        },
      },
    });
    controller.dispatchAction("run");

    try {
      await waitFor(() => {
        const card = runtime
          .getWorkflowInstanceEntries()
          .find((entry) => entry.workflowId === "cards");
        return card?.state.currentState === "unfulfillable";
      }, 15_000);
    } finally {
      // On regression (the retry guard missing) the card loops forever; cancel
      // the running worker so the test fails cleanly instead of hanging.
      controller.cancel();
    }

    const card = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.equal(card?.state.currentState, "unfulfillable");
    assert.ok(
      (card?.state.taskErrorCounts?.validateCompletion ?? 0) >= 3,
      "the engine's per-task error counter accumulated at least three strikes"
    );
    const actions = card?.availableActions.map((action) => action.id);
    assert.ok(
      actions?.includes("archive_card"),
      "unfulfillable exposes the archive (and remediate) actions"
    );
  });

  it("persists card decisions and rehydrates them identically after a restart", async () => {
    // The restart contract: a card driven to a real mid-lifecycle decision
    // with the real operations is persisted, then rebuilt from disk exactly as
    // a server restart would (rehydrateFlow). The decisions must hold — the
    // escalation state, the engine's error counter, and the human actions.
    // This guards the class of bugs where persisted data meets gates that
    // assumed a different shape (name-based dependsOn, counters that were
    // declared but never written, decisions lost on rehydrate).
    const workspacesBasePath = join(root, "workspaces");
    registerFlowDefinition(queenBeeFlow);
    const persistence = createFlowPersistence(join(root, "hive"));

    const lazyWorker = (): AiChatModelCaller => async () => ({
      content: "Nothing to change",
      toolCalls: [
        {
          id: "s1",
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    });
    const calmReviewer = (): AiTaskModelCaller => async () => ({
      content: "ok",
      toolCalls: [],
    });

    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: lazyWorker(),
      reviewerCaller: calmReviewer(),
      persistence,
    });
    // The runtime only saves flow.json on config/state patches; persist the
    // config up front so the restart can rebuild the flow.
    persistence.saveFlow(
      "project",
      {
        definitionId: "queen-bee",
        name: "Project",
        basePath,
        integrationBranch: "queen-bee-main",
        branchPrefix: "queen-bee/",
        domainDir: ".queen-bee",
        workspacesBasePath,
      },
      {}
    );

    const controller = runtime.addWorkflowInstance("cards", {
      workflowInstanceState: {
        attempt: 1,
        cardSpec: {
          title: "Stuck card",
          description: "",
          acceptanceCriteria: ["works"],
          dependsOn: [],
        },
      },
    });
    controller.dispatchAction("run");

    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.currentState === "unfulfillable";
    }, 15_000);

    const persisted = persistence.loadFlow("project");
    assert.ok(persisted, "the driven card is on disk");
    const rehydrated = await rehydrateFlow(
      persistence,
      "project",
      persisted.config,
      persisted.state,
      persisted.instances
    );
    assert.ok(rehydrated);

    const card = rehydrated
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.equal(card?.state.currentState, "unfulfillable");
    assert.ok(
      (card?.state.taskErrorCounts?.validateCompletion ?? 0) >= 3,
      "the engine's error counter survived persistence"
    );
    assert.ok(
      card?.availableActions.some((action) => action.id === "archive_card"),
      "the human escalation actions survived rehydration"
    );
  });

  it("routes an already_satisfied worker to review and done without requiring commits", async () => {
    const workspacesBasePath = join(root, "workspaces");
    // The worker reports the requested behavior already present (no commit
    // created); the card must skip the commit validation, go to review, and
    // the reviewer's approval lands it in done.
    const satisfiedWorker = (): AiChatModelCaller => async () => ({
      content: "Already implemented by the merged dependency",
      toolCalls: [
        {
          id: "s1",
          name: "submit_work",
          arguments: JSON.stringify({
            outcome: "already_satisfied",
            noChangeRationale:
              "Behavior already present on the integration branch",
          }),
        },
      ],
    });

    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: satisfiedWorker(),
      reviewerCaller: approvingReviewerCaller(),
    });

    const controller = runtime.addWorkflowInstance("cards", {
      workflowInstanceState: {
        attempt: 1,
        cardSpec: {
          title: "Already done",
          description: "",
          acceptanceCriteria: ["works"],
          dependsOn: [],
        },
      },
    });
    controller.dispatchAction("run");

    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.currentState === "reviewed";
    }, 15_000);

    const reviewedCard = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.ok(
      reviewedCard?.availableActions.some((action) => action.id === "accept"),
      "an already_satisfied card reaches review and exposes accept"
    );
    reviewedCard &&
      runtime.getWorkflowInstance(reviewedCard.id)?.dispatchAction("accept");

    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.currentState === "done";
    }, 15_000);

    const card = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.equal(card?.state.currentState, "done");
    assert.equal(
      card?.state.taskOutputs.validateCompletion?.status,
      undefined,
      "already_satisfied submissions skip the committed-work validation"
    );
  });

  it("worker edits land in the worktree and accept merges into the integration branch", async () => {
    const workspacesBasePath = join(root, "workspaces");
    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: writingWorkerCaller(),
      reviewerCaller: approvingReviewerCaller(),
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

    // The worker's edits land in the prepared worktree and appear on the
    // feature branch — the isolated-workspace DoD. Reviewed is the first
    // stable stop after the worker, gate, and reviewer have all run.
    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.currentState === "reviewed";
    });
    const card = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.ok(card);
    const worktreePath = readStateString(card, "worktreePath");
    const branchName = readStateString(card, "branchName");
    assert.ok(worktreePath, "prepare_worktree records the worktree path");
    assert.equal(branchName, `queen-bee/${card.id}/attempt-1`);
    assert.ok(existsSync(join(worktreePath, "feature.txt")));
    assert.equal(
      readFileSync(join(worktreePath, "feature.txt"), "utf-8"),
      "implemented"
    );
    assert.equal(
      execSync(`git show ${branchName}:feature.txt`, {
        cwd: basePath,
        encoding: "utf-8",
      }).trim(),
      "implemented"
    );
    const ahead = execSync(
      `git rev-list --count queen-bee-main..${branchName}`,
      {
        cwd: basePath,
        encoding: "utf-8",
      }
    ).trim();
    assert.ok(
      Number(ahead) >= 1,
      "feature branch is ahead of the integration branch"
    );

    // Accept merges the feature branch into queen-bee-main and cleans up.
    assert.ok(
      card.availableActions.some((action) => action.id === "accept"),
      "accept is available when the review is fresh"
    );
    runtime.getWorkflowInstance(card.id)?.dispatchAction("accept");

    await waitFor(() => {
      const entry = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return entry?.state.currentState === "done";
    });

    assert.equal(
      execSync("git show queen-bee-main:feature.txt", {
        cwd: basePath,
        encoding: "utf-8",
      }).trim(),
      "implemented"
    );
    assert.ok(!existsSync(worktreePath), "worktree discarded after accept");
    const refs = execSync("git for-each-ref refs/heads", {
      cwd: basePath,
      encoding: "utf-8",
    }).toString();
    assert.ok(
      !refs.includes(`refs/heads/${branchName}`),
      "feature branch deleted after accept"
    );
  });

  it("stale reviews block accept until the card is re-reviewed", async () => {
    const workspacesBasePath = join(root, "workspaces");
    let releaseReview: () => void = () => {};
    const reviewGate = new Promise<void>((resolve) => {
      releaseReview = resolve;
    });
    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: writingWorkerCaller(),
      reviewerCaller: gatedReviewerCaller(reviewGate),
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

    // Wait until the review package is built (the reviewer is gated, so the
    // card cannot advance past running_review), then move the integration
    // branch so the package's baseCommit is stale when the freshness check
    // eventually runs.
    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return card?.state.taskOutputs.buildPackage?.status === "success";
    });
    execSync("git checkout queen-bee-main", {
      cwd: basePath,
      encoding: "utf-8",
    });
    writeFileSync(join(basePath, "later.txt"), "later\n");
    execSync("git add -A && git commit -m later", {
      cwd: basePath,
      encoding: "utf-8",
    });
    releaseReview();

    await waitFor(() => {
      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return (
        card?.state.currentState === "reviewed" &&
        card.state.workflowInstanceState.reviewIsStale === true
      );
    });
    const card = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.ok(card);
    const actionIds = card.availableActions.map((action) => action.id);
    assert.ok(
      !actionIds.includes("accept"),
      "accept hidden when review is stale"
    );
    assert.ok(
      actionIds.includes("re_review"),
      "re-review offered when review is stale"
    );

    // Re-review rebuilds the package against the current head and re-enables accept.
    runtime.getWorkflowInstance(card.id)?.dispatchAction("re_review");
    await waitFor(() => {
      const entry = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      return (
        entry?.state.currentState === "reviewed" &&
        entry.state.workflowInstanceState.reviewIsStale === false
      );
    });
    const refreshed = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.workflowId === "cards");
    assert.ok(
      refreshed?.availableActions.some((action) => action.id === "accept"),
      "accept re-enabled after re-review"
    );
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

// Builds a queen-bee runtime whose ai-chat/ai-task sessions run against stubbed
// model callers, while operations and tools use the real engine wiring. Flow
// config declares the git identity upfront (as the onboarding workflow would),
// so a cards instance can run end-to-end without a model.
function makeCardRuntime(options: {
  basePath: string;
  workspacesBasePath: string;
  workerCaller: AiChatModelCaller;
  reviewerCaller: AiTaskModelCaller;
  persistence?: FlowStore;
}): ReturnType<typeof createFlowRuntime> {
  const flowConfig = {
    definitionId: "queen-bee",
    name: "Project",
    basePath: options.basePath,
    integrationBranch: "queen-bee-main",
    branchPrefix: "queen-bee/",
    domainDir: ".queen-bee",
    workspacesBasePath: options.workspacesBasePath,
  };
  const baseRunners = createEngineRunners({
    tools: queenBeeFlow.tools,
    operations: queenBeeOperations,
  });
  return createFlowRuntime(
    "project",
    queenBeeFlow.workflows,
    queenBeeFlow.edges,
    {
      operation: baseRunners.operationRunner,
      "ai-chat": (ctx) =>
        createAiChatRunner({
          modelCaller: options.workerCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readConfiguredBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
        }),
      "ai-task": (ctx) =>
        createAiTaskRunner({
          modelCaller: options.reviewerCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          basePath: readConfiguredBasePath(ctx),
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
        }),
    },
    flowConfig,
    {},
    options.persistence
  );
}

function readConfiguredBasePath(ctx: TaskRunnerContext): string | undefined {
  const basePath = ctx.flowConfig.basePath;
  return typeof basePath === "string" && basePath !== "" ? basePath : undefined;
}

function writingWorkerCaller(): AiChatModelCaller {
  let calls = 0;
  return async () => {
    calls++;
    if (calls === 1) {
      return {
        content: "Writing the feature",
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            arguments: JSON.stringify({
              path: "feature.txt",
              content: "implemented",
            }),
          },
        ],
      };
    }
    if (calls === 2) {
      return {
        content: "Committing the feature",
        toolCalls: [
          {
            id: "w2",
            name: "commit_work",
            arguments: JSON.stringify({
              message: "implement feature",
              paths: ["feature.txt"],
            }),
          },
        ],
      };
    }
    return {
      content: "Submitting work",
      toolCalls: [
        {
          id: "w3",
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    };
  };
}

function approvingReviewerCaller(): AiTaskModelCaller {
  return async () => ({
    content: "The change looks good",
    toolCalls: [
      {
        id: "r1",
        name: "submit_review",
        arguments: JSON.stringify({
          verdict: "approved",
          findings: [],
          verificationAssessment: { status: "sufficient", notes: "ok" },
        }),
      },
    ],
  });
}

function gatedReviewerCaller(release: Promise<void>): AiTaskModelCaller {
  return async () => {
    await release;
    return {
      content: "The change looks good",
      toolCalls: [
        {
          id: "r1",
          name: "submit_review",
          arguments: JSON.stringify({
            verdict: "approved",
            findings: [],
            verificationAssessment: { status: "sufficient", notes: "ok" },
          }),
        },
      ],
    };
  };
}

function readStateString(
  entry: { state: { workflowInstanceState: Record<string, unknown> } },
  key: string
): string {
  const value = entry.state.workflowInstanceState[key];
  return typeof value === "string" ? value : "";
}
