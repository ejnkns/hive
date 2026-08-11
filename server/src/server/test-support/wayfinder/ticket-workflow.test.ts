import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  chatReply,
  chatRespond,
  chatToolCall,
  idleModelCaller,
  makeWayfinderRuntime,
  taskCompleter,
  waitFor,
} from "./test-helpers.ts";

describe("wayfinder ticket workflow", () => {
  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-wayfinder-ticket-"));
    tempDirs.push(dir);
    return dir;
  }

  // Graduate honors the gate contract: the ticket's fog state runs an auto
  // normalize task on entry, so graduate (gated on !hasRunningTask) only
  // dispatches once that task has finished — as a UI user would click it.
  async function graduate(controller: {
    getState(): { hasRunningTask: boolean };
    dispatchAction(actionId: string): void;
  }): Promise<void> {
    await waitFor(() => !controller.getState().hasRunningTask);
    controller.dispatchAction("graduate");
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a research ticket resolves to closed and persists the decision and findings records", async () => {
    const basePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      aiChatCaller: idleModelCaller(),
      aiTaskCaller: taskCompleter("submit_findings", {
        question: "localStorage or IndexedDB?",
        findings:
          "# Findings\nIndexedDB is the right store for the editor's large documents.",
        sources: ["https://example.com/indexeddb"],
      }),
    });

    const controller = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Choose the store",
        question: "localStorage or IndexedDB?",
        type: "research",
        dependsOn: [],
      },
    });
    const ticketId = controller.id;

    await graduate(controller);
    assert.equal(controller.getState().currentState, "ready");

    const readyActions = controller.getAvailableActions().map((a) => a.id);
    assert.ok(readyActions.includes("claim_research"));

    controller.dispatchAction("claim_research");
    await waitFor(() => controller.getState().currentState === "closed");

    const decisionRecord = readFileSync(
      join(basePath, ".wayfinder", "decisions", `${ticketId}.md`),
      "utf-8"
    );
    assert.match(decisionRecord, /Decision — Choose the store/);
    assert.match(decisionRecord, /localStorage or IndexedDB\?/);

    const findings = readFileSync(
      join(basePath, ".wayfinder", "research", `${ticketId}.md`),
      "utf-8"
    );
    assert.match(findings, /IndexedDB is the right store/);
    assert.match(findings, /https:\/\/example.com\/indexeddb/);
  });

  it("claim actions gate on the ticket type", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: idleModelCaller(),
      aiTaskCaller: idleModelCaller(),
    });

    const controller = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Grill the auth model",
        question: "What is the auth model?",
        type: "grilling",
        dependsOn: [],
      },
    });
    await graduate(controller);
    assert.equal(controller.getState().currentState, "ready");

    const actionIds = controller.getAvailableActions().map((a) => a.id);
    assert.ok(actionIds.includes("claim_grilling"));
    assert.ok(!actionIds.includes("claim_research"));
    assert.ok(!actionIds.includes("claim_prototype"));
    assert.ok(!actionIds.includes("claim_task"));
    assert.ok(!actionIds.includes("claim_task_hitl"));
  });

  it("a task ticket routes hitl to the session claim and afk to the one-shot claim", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: idleModelCaller(),
      aiTaskCaller: idleModelCaller(),
    });

    const afk = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Run the migration",
        type: "task",
        dependsOn: [],
      },
    });
    await graduate(afk);
    assert.ok(afk.getAvailableActions().some((a) => a.id === "claim_task"));
    assert.ok(
      !afk.getAvailableActions().some((a) => a.id === "claim_task_hitl")
    );

    const hitl = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Walk the deploy checklist",
        type: "task",
        hitl: true,
        dependsOn: [],
      },
    });
    await graduate(hitl);
    assert.ok(
      hitl.getAvailableActions().some((a) => a.id === "claim_task_hitl")
    );
    assert.ok(!hitl.getAvailableActions().some((a) => a.id === "claim_task"));
  });

  it("claim actions are hidden until every dependsOn blocker is closed", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: idleModelCaller(),
      aiTaskCaller: taskCompleter("submit_findings", {
        question: "Which index?",
        findings: "# Findings\nA covering index on the payload column.",
        sources: [],
      }),
    });

    const blocker = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Pick the index",
        type: "research",
        dependsOn: [],
      },
    });
    await graduate(blocker);

    const dependent = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Write the query",
        type: "research",
        dependsOn: [blocker.id],
      },
    });
    await graduate(dependent);

    assert.equal(dependent.getState().currentState, "ready");
    const blockedActions = dependent.getAvailableActions().map((a) => a.id);
    assert.ok(
      !blockedActions.includes("claim_research"),
      "claim hidden while a blocker is open"
    );

    // The dependsOnState backstop also blocks a direct dispatch attempt.
    dependent.dispatchAction("claim_research");
    assert.equal(
      dependent.getState().currentState,
      "ready",
      "dispatch of a gated claim is blocked while a blocker is open"
    );

    // Resolve the blocker; the dependent's frontier opens.
    blocker.dispatchAction("claim_research");
    await waitFor(() => blocker.getState().currentState === "closed");

    const openActions = dependent.getAvailableActions().map((a) => a.id);
    assert.ok(openActions.includes("claim_research"));

    dependent.dispatchAction("claim_research");
    assert.equal(dependent.getState().currentState, "resolving_research");
  });

  it("a grilling ticket resolves via the human's Done action", async () => {
    const basePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      aiChatCaller: chatRespond(
        chatToolCall("submit_resolution", {
          decision: "OAuth2 with refresh tokens",
          gist: "The human confirmed the auth model over the exchange.",
        }),
        chatReply("Shared understanding confirmed — press Done when ready.")
      ),
      aiTaskCaller: idleModelCaller(),
    });

    const controller = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Grill the auth model",
        question: "Which auth flow?",
        type: "grilling",
        dependsOn: [],
      },
    });
    await graduate(controller);
    controller.dispatchAction("claim_grilling");
    assert.equal(controller.getState().currentState, "resolving_grilling");

    controller.sendTaskInput(
      "grillSession",
      "Let's settle the auth flow.",
      "user"
    );
    // The agent records the resolution (submit_resolution), then waits; the
    // human ends the live exchange with Done.
    await waitFor(() => {
      const state = controller.getState().workflowInstanceState;
      return (
        typeof state.resolution === "object" &&
        state.resolution !== null &&
        typeof (state.resolution as { decision?: unknown }).decision ===
          "string"
      );
    });
    controller.dispatchAction("done");

    await waitFor(() => controller.getState().currentState === "closed");
    const record = readFileSync(
      join(basePath, ".wayfinder", "decisions", `${controller.id}.md`),
      "utf-8"
    );
    assert.match(record, /OAuth2 with refresh tokens/);
  });

  it("a prototype ticket works in a prepared workspace and links its artifact", async () => {
    const basePath = tempDir();
    const workspacesBasePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      workspacesBasePath,
      aiChatCaller: chatRespond(
        chatToolCall("write_file", {
          path: "proto.ts",
          content: "export const answer = 42;\n",
        }),
        chatToolCall("submit_resolution", {
          decision: "The data flow should be a single pass",
          gist: "Prototyped the logic branch; the artifact shows the full state.",
          artifactPath: "proto.ts",
        }),
        chatReply("Prototype captured — press Done when satisfied.")
      ),
      aiTaskCaller: idleModelCaller(),
    });

    const controller = runtime.addWorkflowInstance("ticket", {
      workflowInstanceState: {
        title: "Prototype the data flow",
        question: "Should the data flow be a single pass or streamed?",
        type: "prototype",
        dependsOn: [],
      },
    });
    await graduate(controller);
    controller.dispatchAction("claim_prototype");

    // prepare_prototype_workspace records the sandbox before the session starts.
    await waitFor(() => {
      const worktreePath =
        controller.getState().workflowInstanceState.worktreePath;
      return typeof worktreePath === "string" && worktreePath !== "";
    });
    const worktreePath = controller.getState().workflowInstanceState
      .worktreePath as string;

    // The session must be running (started after prepare) before its first
    // input; a message sent earlier is dropped.
    await waitFor(
      () => controller.getState().runningTaskId === "prototypeSession"
    );
    controller.sendTaskInput(
      "prototypeSession",
      "Prototype the logic branch.",
      "user"
    );
    await waitFor(() => existsSync(join(worktreePath, "proto.ts")));
    controller.dispatchAction("done");

    await waitFor(() => controller.getState().currentState === "closed");
    const record = readFileSync(
      join(basePath, ".wayfinder", "decisions", `${controller.id}.md`),
      "utf-8"
    );
    assert.match(record, /Artifact: proto\.ts/);
  });
});
