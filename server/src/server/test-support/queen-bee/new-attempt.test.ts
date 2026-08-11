// Engine-owned attempt bookkeeping, end to end: ManualAction.newAttempt must
// produce a genuinely fresh attempt — a new branch and worktree and a
// non-colliding {attempt} persist path — while the old attempt stays
// identifiable. This is the regression guard for the original bug class:
// `attempt` was declared and read (branch naming, persist paths) but never
// written, so a "new attempt" silently reused branch/attempt-1 and overwrote
// reviews/{instanceId}-attempt-1.json.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AiChatModelCaller } from "./card-flow-harness.ts";
import {
  addReadyCard,
  cleanupCardRepo,
  makeCardRuntime,
  rejectingReviewer,
  setupCardRepo,
  waitFor,
} from "./card-flow-harness.ts";

// The honest worker on every attempt: write, commit, submit — cycling so a
// second attempt (fresh workspace) commits again instead of submitting stale.
function alwaysHonestWorker(): AiChatModelCaller {
  let calls = 0;
  return async () => {
    calls += 1;
    const phase = (calls - 1) % 3;
    if (phase === 0) {
      return {
        content: "Implementing",
        toolCalls: [
          {
            id: `w${calls}`,
            name: "write_file",
            arguments: JSON.stringify({
              path: "feature.txt",
              content: "attempt work",
            }),
          },
        ],
      };
    }
    if (phase === 1) {
      return {
        content: "Committing",
        toolCalls: [
          {
            id: `c${calls}`,
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
      content: "Submitting",
      toolCalls: [
        {
          id: `s${calls}`,
          name: "submit_work",
          arguments: JSON.stringify({ outcome: "implemented" }),
        },
      ],
    };
  };
}

function branchExists(basePath: string, branch: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
      cwd: basePath,
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

function cardEntry(
  runtime: ReturnType<typeof makeCardRuntime>,
  cardId: string
) {
  return runtime
    .getWorkflowInstanceEntries()
    .find((entry) => entry.id === cardId);
}

describe("newAttempt starts a fresh attempt without colliding", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) cleanupCardRepo(root);
  });

  it("new_changes bumps the attempt, discards the old worktree, and re-runs on attempt-2", async () => {
    const { root, basePath } = setupCardRepo();
    roots.push(root);
    const workspacesBasePath = join(root, "workspaces");
    const runtime = makeCardRuntime({
      basePath,
      workspacesBasePath,
      workerCaller: alwaysHonestWorker(),
      reviewerCaller: rejectingReviewer(),
    });

    const card = addReadyCard(runtime);
    const cardId = card.id;

    // Drive attempt 1 to reviewed with a changes_requested verdict.
    await waitFor(
      () => cardEntry(runtime, cardId)?.state.currentState === "reviewed",
      20_000
    );
    const attempt1Branch = `queen-bee/${cardId}/attempt-1`;
    // {attempt} in a persist path resolves to the counter value: the review
    // package lands at reviews/<cardId>-1.json — the file a pre-newAttempt
    // "new attempt" would have silently overwritten.
    const attempt1Package = join(
      basePath,
      ".queen-bee",
      "reviews",
      `${cardId}-1.json`
    );
    assert.ok(
      branchExists(basePath, attempt1Branch),
      "attempt-1 branch exists after the first run"
    );
    assert.ok(
      existsSync(attempt1Package),
      "attempt-1 review package persisted"
    );
    const oldWorktree = card.getState().workflowInstanceState
      .worktreePath as string;
    assert.ok(existsSync(oldWorktree), "attempt-1 worktree exists");

    // new_changes: the engine bumps the counter and discards the workspace.
    card.dispatchAction("new_changes");
    assert.equal(card.getState().workflowInstanceState.attempt, 2);
    assert.ok(!existsSync(oldWorktree), "attempt-1 worktree was discarded");
    assert.ok(
      branchExists(basePath, attempt1Branch),
      "attempt-1 branch stays identifiable after the new attempt"
    );

    // Run again: prepare_worktree builds attempt-2 and the flow re-runs.
    card.dispatchAction("run");
    await waitFor(
      () => cardEntry(runtime, cardId)?.state.currentState === "reviewed",
      20_000
    );

    const attempt2Branch = `queen-bee/${cardId}/attempt-2`;
    const attempt2Package = join(
      basePath,
      ".queen-bee",
      "reviews",
      `${cardId}-2.json`
    );
    assert.ok(
      branchExists(basePath, attempt2Branch),
      "attempt-2 branch was created, not reused"
    );
    assert.ok(
      existsSync(attempt2Package),
      "attempt-2 review package persisted to a non-colliding path"
    );
    assert.equal(
      card.getState().workflowInstanceState.attempt,
      2,
      "instance attempt counter stays at 2"
    );
    const activeWorktree = card.getState().workflowInstanceState.worktreePath;
    assert.ok(
      typeof activeWorktree === "string" &&
        !activeWorktree.endsWith("attempt-1"),
      "the active worktree is the attempt-2 workspace"
    );
  });
});
