import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ToolDefinition } from "workflow-engine/runners";
import { chatReply, makeWayfinderRuntime, waitFor } from "./test-helpers.ts";

describe("wayfinder build workflow", () => {
  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-wayfinder-build-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec-plans, quizzes the breakdown, fans out build items, and runs one to done", async () => {
    const basePath = tempDir();
    const workspacesBasePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      workspacesBasePath,
      aiChatCaller: buildPhaseChatCaller(),
      aiTaskCaller: buildPhaseTaskCaller(),
    });

    const controller = runtime.addWorkflowInstance("build");
    assert.equal(controller.getState().currentState, "specing");

    // Specing session: the agent records the spec; the human presses Done.
    await waitFor(() => controller.getState().runningTaskId === "specSession");
    controller.sendTaskInput("specSession", "Collapse the decisions.", "user");
    await waitFor(() => {
      const spec = controller.getState().workflowInstanceState.spec;
      return typeof spec === "string" && spec !== "";
    });
    controller.dispatchAction("done");

    // planned: the spec persists and the planner proposes tracer bullets.
    await waitFor(() => controller.getState().currentState === "planned");
    await waitFor(() => existsSync(join(basePath, ".wayfinder", "spec.md")));
    await waitFor(() => controller.getState().currentState === "proposed");
    const proposedActions = controller.getAvailableActions().map((a) => a.id);
    assert.ok(proposedActions.includes("accept_proposal"));
    assert.ok(proposedActions.includes("request_revision"));

    // Accept the breakdown; finalizing persists the plan and the accepted
    // terminal fans out one build-item per planned ticket.
    controller.dispatchAction("accept_proposal");
    await waitFor(() => controller.getState().currentState === "accepted");
    await waitFor(() =>
      existsSync(join(basePath, ".wayfinder", "build-plan.md"))
    );
    const planBody = readFileSync(
      join(basePath, ".wayfinder", "build-plan.md"),
      "utf-8"
    );
    assert.match(planBody, /Implement the editor core/);

    const buildItems = await waitForBuildItems(runtime, 2);
    assert.ok(
      buildItems.every((entry) => entry.state.currentState === "ready")
    );
    assert.equal(
      readTicketTitle(buildItems[0].state.workflowInstanceState),
      "Implement the editor core"
    );

    // Run the first build item through worker + reviewer to done.
    const first = buildItems[0];
    runtime.getWorkflowInstance(first.id)?.dispatchAction("run");
    await waitFor(() => {
      const entry = runtime
        .getWorkflowInstanceEntries()
        .find((candidate) => candidate.id === first.id);
      return entry?.state.currentState === "done";
    });

    // The worker's edits landed in its isolated workspace.
    const done = runtime
      .getWorkflowInstanceEntries()
      .find((candidate) => candidate.id === first.id);
    assert.ok(done);
    const worktreePath = done.state.workflowInstanceState.worktreePath;
    assert.ok(typeof worktreePath === "string" && worktreePath !== "");
    assert.ok(existsSync(join(worktreePath as string, "core.ts")));
  });

  it("request_revision returns the proposal to a fresh specing session", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: buildPhaseChatCaller(),
      aiTaskCaller: buildPhaseTaskCaller(),
    });

    const controller = runtime.addWorkflowInstance("build");
    await waitFor(() => controller.getState().runningTaskId === "specSession");
    controller.sendTaskInput("specSession", "Draft the spec.", "user");
    await waitFor(() => {
      const spec = controller.getState().workflowInstanceState.spec;
      return typeof spec === "string" && spec !== "";
    });
    controller.dispatchAction("done");
    await waitFor(() => controller.getState().currentState === "proposed");

    controller.dispatchAction("request_revision");
    assert.equal(controller.getState().currentState, "specing");
    await waitFor(() => controller.getState().runningTaskId === "specSession");

    // Drive the fresh session to completion so no dangling session keeps the
    // test's event loop from draining.
    controller.sendTaskInput("specSession", "Revise the seams.", "user");
    await waitFor(() => {
      const spec = controller.getState().workflowInstanceState.spec;
      return typeof spec === "string" && spec !== "";
    });
    controller.dispatchAction("done");
    await waitFor(() => controller.getState().currentState === "planned");
  });

  it("a changes_requested review reworks the build item", async () => {
    const workspacesBasePath = tempDir();
    const reviewGate = gatedPromise();
    const reworkGate = gatedPromise();
    const runtime = makeWayfinderRuntime({
      workspacesBasePath,
      aiChatCaller: gatedWorkerCaller(reworkGate),
      aiTaskCaller: gatedReworkReviewerCaller(reviewGate),
    });

    const controller = runtime.addWorkflowInstance("buildItem", {
      workflowInstanceState: {
        ticket: {
          title: "Wire the store",
          description: "Connect the store to the editor.",
          acceptanceCriteria: ["the store feeds the editor"],
        },
        dependsOn: [],
      },
    });
    controller.dispatchAction("run");

    try {
      // The gated first review holds the item in reviewing so the verdict is
      // observable; releasing it returns changes_requested and the item reworks.
      await waitFor(() => controller.getState().currentState === "reviewing");
      reviewGate.release();

      // The rework worker is gated on its first rework call, so the running
      // state is stable and the first review's verdict is still recorded.
      await waitFor(
        () =>
          controller.getState().currentState === "running" &&
          controller.getState().runningTaskId === "runAgent"
      );
      assert.equal(
        readReviewVerdict(controller.getState()),
        "changes_requested"
      );

      // Releasing the rework worker passes the second review and lands in done.
      reworkGate.release();
      await waitFor(() => controller.getState().currentState === "done");
      assert.equal(readReviewVerdict(controller.getState()), "approved");
    } finally {
      reviewGate.release();
      reworkGate.release();
    }
  });
});

// The build phase's ai-chat caller: the specing session records the spec via
// submit_spec; the build-item worker writes code then submits. Dispatched on
// the tools the session was offered.
function buildPhaseChatCaller() {
  let specingCalls = 0;
  let workerCalls = 0;
  return async (
    _systemPrompt: string,
    _messages: unknown,
    tools: ToolDefinition[]
  ) => {
    const has = (name: string) =>
      tools.some((tool) => tool.function.name === name);
    if (has("submit_spec")) {
      specingCalls++;
      if (specingCalls === 1) {
        return {
          content: "Spec drafted",
          toolCalls: [
            {
              id: "s1",
              name: "submit_spec",
              arguments: JSON.stringify({
                spec: "# Spec\n\nThe editor core needs a document model.",
                seams: ["document-model.ts"],
              }),
            },
          ],
        };
      }
      return chatReply(
        "Spec recorded — press Done when the seams are agreed."
      )();
    }
    workerCalls++;
    if (workerCalls === 1) {
      return {
        content: "Writing the core",
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            arguments: JSON.stringify({
              path: "core.ts",
              content: "export const core = true;\n",
            }),
          },
        ],
      };
    }
    return {
      content: "Submitting work",
      toolCalls: [
        {
          id: "w2",
          name: "buildItem_runAgent_complete",
          arguments: JSON.stringify({
            outcome: "implemented",
            summary: "Implemented the core with a passing check.",
          }),
        },
      ],
    };
  };
}

// The build phase's ai-task caller: the planner proposes tickets; the reviewer
// approves. Dispatched on the completion tool offered.
function buildPhaseTaskCaller() {
  return async (
    _systemPrompt: string,
    _messages: unknown,
    tools: ToolDefinition[]
  ) => {
    const has = (name: string) =>
      tools.some((tool) => tool.function.name === name);
    if (has("build_plan_complete")) {
      return {
        content: "Plan ready",
        toolCalls: [
          {
            id: "p1",
            name: "build_plan_complete",
            arguments: JSON.stringify({
              tickets: [
                {
                  title: "Implement the editor core",
                  description: "The document model and command surface.",
                  acceptanceCriteria: ["a document opens"],
                  dependsOn: [],
                },
                {
                  title: "Persist documents",
                  description: "Save and load the document model.",
                  acceptanceCriteria: ["documents persist across reloads"],
                  dependsOn: ["Implement the editor core"],
                },
              ],
            }),
          },
        ],
      };
    }
    return {
      content: "Review approved",
      toolCalls: [
        {
          id: "r1",
          name: "buildItem_review_complete",
          arguments: JSON.stringify({
            verdict: "approved",
            findings: [],
          }),
        },
      ],
    };
  };
}

async function waitForBuildItems(
  runtime: ReturnType<typeof makeWayfinderRuntime>,
  count: number
) {
  let items: ReturnType<typeof runtime.getWorkflowInstanceEntries> = [];
  await waitFor(() => {
    items = runtime
      .getWorkflowInstanceEntries()
      .filter((entry) => entry.workflowId === "buildItem");
    return items.length >= count;
  });
  return items;
}

function readTicketTitle(state: Record<string, unknown>): string {
  const ticket = state.ticket;
  if (ticket === null || typeof ticket !== "object") return "";
  const title = (ticket as { title?: unknown }).title;
  return typeof title === "string" ? title : "";
}

function readReviewVerdict(state: {
  taskOutputs: Record<string, unknown>;
}): string | undefined {
  const review = state.taskOutputs.review;
  if (review === null || typeof review !== "object") return undefined;
  const output = (review as { output?: unknown }).output;
  if (output === null || typeof output !== "object") return undefined;
  const verdict = (output as { verdict?: unknown }).verdict;
  return typeof verdict === "string" ? verdict : undefined;
}

// A worker that implements, submits, and on the rework attempt waits for a gate
// before submitting again, so the rework working state is stable.
function gatedWorkerCaller(reworkGate: {
  release: () => void;
  promise: Promise<void>;
}) {
  let workerCalls = 0;
  return async (
    _systemPrompt: string,
    _messages: unknown,
    tools: ToolDefinition[]
  ) => {
    const has = (name: string) =>
      tools.some((tool) => tool.function.name === name);
    if (has("submit_spec")) {
      return { content: "Spec drafted", toolCalls: [] };
    }
    workerCalls++;
    if (workerCalls === 1) {
      return {
        content: "Writing the core",
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            arguments: JSON.stringify({
              path: "core.ts",
              content: "export const core = true;\n",
            }),
          },
        ],
      };
    }
    if (workerCalls === 2) {
      return {
        content: "Submitting work",
        toolCalls: [
          {
            id: "w2",
            name: "buildItem_runAgent_complete",
            arguments: JSON.stringify({
              outcome: "implemented",
              summary: "Implemented the core.",
            }),
          },
        ],
      };
    }
    await reworkGate.promise;
    return {
      content: "Submitting rework",
      toolCalls: [
        {
          id: "w3",
          name: "buildItem_runAgent_complete",
          arguments: JSON.stringify({
            outcome: "implemented",
            summary: "Reworked per the review.",
          }),
        },
      ],
    };
  };
}

// A reviewer that returns changes_requested on the first review and approved on
// the second, so the rework loop terminates. The first review is gated so the
// reviewing state is observable.
function gatedReworkReviewerCaller(reviewGate: {
  release: () => void;
  promise: Promise<void>;
}) {
  let reviews = 0;
  return async () => {
    reviews++;
    if (reviews === 1) {
      await reviewGate.promise;
      return {
        content: "Review complete",
        toolCalls: [
          {
            id: "rev1",
            name: "buildItem_review_complete",
            arguments: JSON.stringify({
              verdict: "changes_requested",
              findings: [
                {
                  axis: "spec",
                  severity: "blocking",
                  detail: "The acceptance criteria are not met.",
                },
              ],
            }),
          },
        ],
      };
    }
    return {
      content: "Review complete",
      toolCalls: [
        {
          id: "rev2",
          name: "buildItem_review_complete",
          arguments: JSON.stringify({
            verdict: "approved",
            findings: [],
          }),
        },
      ],
    };
  };
}

function gatedPromise(): { release: () => void; promise: Promise<void> } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}
