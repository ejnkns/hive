// Behavior-library invariant: every realistic agent outcome the cards workflow
// can receive must terminate in a bounded, human-actionable state — never an
// infinite retry loop. This is the generic guard against dead retry guards and
// missing outcome paths (the Shapes card looped 12+ times because a guard was
// declared but never wired; an honest no-change worker had no success path).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  addReadyCard,
  alreadySatisfiedWorker,
  approvingReviewer,
  cleanupCardRepo,
  honestWorker,
  makeCardRuntime,
  noCommitWorker,
  rejectingReviewer,
  setupCardRepo,
  toolAbuseWorker,
  waitFor,
} from "./card-flow-harness";

type Scenario = {
  name: string;
  worker: ReturnType<typeof honestWorker>;
  reviewer: ReturnType<typeof approvingReviewer>;
  // The terminal state the card must reach, and the actions a human must have.
  terminal: string;
  requiredAction?: string;
};

// Every behavior, parameterized: the invariant is "bounded termination + a
// human path forward". The waitFor timeout makes an infinite loop fail the
// test (red), and the requiredAction asserts the state is not a dead end.
const scenarios: Scenario[] = [
  {
    name: "honest worker commits and submits, reviewer approves",
    worker: honestWorker(),
    reviewer: approvingReviewer(),
    terminal: "reviewed",
    requiredAction: "accept",
  },
  {
    name: "already_satisfied routes to review, not a commit trap",
    worker: alreadySatisfiedWorker(),
    reviewer: approvingReviewer(),
    terminal: "reviewed",
    requiredAction: "accept",
  },
  {
    name: "no-commit submit escalates to unfulfillable, not a loop",
    worker: noCommitWorker(),
    reviewer: approvingReviewer(),
    terminal: "unfulfillable",
    requiredAction: "archive_card",
  },
  {
    name: "tool abuse surfaces as a tool error; no commit escalates",
    worker: toolAbuseWorker(),
    reviewer: approvingReviewer(),
    terminal: "unfulfillable",
    requiredAction: "archive_card",
  },
  {
    name: "a rejected claim waits for the human in reviewed (changes requested)",
    worker: honestWorker(),
    reviewer: rejectingReviewer(),
    terminal: "reviewed",
    requiredAction: "new_changes",
  },
];

describe("cards workflow agent behaviors terminate safely", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) cleanupCardRepo(root);
  });

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const { root, basePath } = setupCardRepo();
      roots.push(root);
      const workspacesBasePath = join(root, "workspaces");
      const runtime = makeCardRuntime({
        basePath,
        workspacesBasePath,
        workerCaller: scenario.worker,
        reviewerCaller: scenario.reviewer,
      });

      addReadyCard(runtime);

      await waitFor(() => {
        const card = runtime
          .getWorkflowInstanceEntries()
          .find((entry) => entry.workflowId === "cards");
        return card?.state.currentState === scenario.terminal;
      }, 20_000);

      const card = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "cards");
      assert.equal(card?.state.currentState, scenario.terminal);
      if (scenario.requiredAction) {
        assert.ok(
          card?.availableActions.some(
            (action) => action.id === scenario.requiredAction
          ),
          `${scenario.terminal} must expose ${scenario.requiredAction}`
        );
      }
    });
  }
});

function join(...parts: string[]): string {
  return parts.join("/");
}
