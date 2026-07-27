import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { RequirementsFeedback } from "shared/board-types";
import type { Message } from "shared/message";
import { createQueenBeeRuntimeStore } from "../../queen-bee-runtime-store";
import { createRequirementsSessionManager } from "../../requirements-session";
import {
  completionResponse,
  createMockCaller,
  draftResponse,
  emptyResponse,
} from "../test-helpers";

describe("resetSession", () => {
  it("removes an active session", async () => {
    const caller = createMockCaller([emptyResponse("First question")]);
    const runtimeStore = createQueenBeeRuntimeStore(
      join(mkdtempSync(join(tmpdir(), "hive-reset-")), ".runtime")
    );
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: caller,
      runtimeStore,
    });

    await engine.start("p1", "Build it", "/tmp");
    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected active session");
    assert.strictEqual(session.status, "active");

    await engine.resetSession("p1", session.sessionId);
    assert.strictEqual(engine.getSession("p1"), undefined);

    const persisted = runtimeStore.getRequirementsSessions("p1");
    assert.strictEqual(persisted.length, 0);
  });

  it("allows a new session to start after reset", async () => {
    const caller = createMockCaller([
      emptyResponse("First question"),
      emptyResponse("New question"),
    ]);
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: caller,
    });

    await engine.start("p1", "Build it", "/tmp");
    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected session");
    await engine.resetSession("p1", session.sessionId);

    const result = await engine.start("p1", "New attempt", "/tmp");
    assert.strictEqual(result.question, "New question");
  });

  it("removes a complete session", async () => {
    const caller = createMockCaller([
      emptyResponse("Q1"),
      draftResponse(),
      completionResponse(),
    ]);
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: caller,
    });

    await engine.start("p1", "Build it", "/tmp");
    await engine.respond("p1", "Done", "/tmp");
    assert.strictEqual(engine.getSession("p1")?.status, "complete");

    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected complete session");
    await engine.resetSession("p1", session.sessionId);
    assert.strictEqual(engine.getSession("p1"), undefined);
  });

  it("throws for a submitted session", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "hive-reset-submitted-"));
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const caller = createMockCaller([
      emptyResponse("Q1"),
      draftResponse(),
      completionResponse(),
    ]);
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: caller,
      runtimeStore,
    });

    await engine.start("p1", "Build it", workspace);
    await engine.respond("p1", "Done", workspace);
    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected completed session");
    assert.strictEqual(session.status, "complete");
    const submittedSessionId = session.sessionId;
    engine.submitForPlanning("p1", submittedSessionId, "proposal-1");

    await assert.rejects(
      () => engine.resetSession("p1", submittedSessionId),
      /Cannot reset a submitted/
    );
    assert.strictEqual(engine.getSession("p1")?.status, "submitted");
  });

  it("throws for an unknown session", async () => {
    const engine = createRequirementsSessionManager({ maxToolRounds: 30 });
    await assert.rejects(
      () => engine.resetSession("p1", "nonexistent"),
      /not found/
    );
  });

  it("rolls back feedback from repairing to pending", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "hive-reset-feedback-"));
    mkdirSync(join(workspace, ".hive"), { recursive: true });
    writeFileSync(join(workspace, ".hive", "requirements.md"), "# Canonical");
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "fb-1",
      projectId: "p1",
      status: "pending",
      projectRevision: null,
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      proposedRequirements: "# Draft",
      createdAt: "2026-07-20T00:01:00.000Z",
      issues: [],
    };
    runtimeStore.saveRequirementsFeedback(feedback);
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: createMockCaller([emptyResponse("Fix what?")]),
      runtimeStore,
    });

    await engine.startRepair("p1", feedback, workspace);
    assert.strictEqual(
      runtimeStore.getRequirementsFeedback("p1", "fb-1")?.status,
      "repairing"
    );

    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected session");
    await engine.resetSession("p1", session.sessionId);
    assert.strictEqual(
      runtimeStore.getRequirementsFeedback("p1", "fb-1")?.status,
      "pending"
    );
  });

  it("does not affect feedback that is already resolved", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "hive-reset-resolved-"));
    mkdirSync(join(workspace, ".hive"), { recursive: true });
    writeFileSync(join(workspace, ".hive", "requirements.md"), "# Canonical");
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "fb-2",
      projectId: "p1",
      status: "resolved",
      projectRevision: null,
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      proposedRequirements: "# Draft",
      createdAt: "2026-07-20T00:01:00.000Z",
      resolvedAt: "2026-07-20T01:00:00.000Z",
      issues: [],
    };
    runtimeStore.saveRequirementsFeedback(feedback);
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: createMockCaller([emptyResponse("Question")]),
      runtimeStore,
    });

    await engine.start("p1", "Build it", workspace);
    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected session");
    assert.strictEqual(session.sourceFeedbackId, undefined);

    await engine.resetSession("p1", session.sessionId);
    assert.strictEqual(
      runtimeStore.getRequirementsFeedback("p1", "fb-2")?.status,
      "resolved"
    );
  });

  it("aborts an in-flight respond call", async () => {
    const runtimeStore = createQueenBeeRuntimeStore(
      join(mkdtempSync(join(tmpdir(), "hive-reset-respond-")), ".runtime")
    );
    let respondCallSignal: AbortSignal | undefined;
    let callIndex = 0;
    const engine = createRequirementsSessionManager({
      maxToolRounds: 30,
      modelCaller: {
        async call(
          _messages: Message[],
          _ws: string,
          _includeTools: boolean,
          signal?: AbortSignal
          // biome-ignore lint/suspicious/noExplicitAny: mock return type
        ): Promise<any> {
          callIndex++;
          if (callIndex === 1) {
            return emptyResponse("First question");
          }
          respondCallSignal = signal;
          return new Promise(() => {});
        },
      },
      runtimeStore,
    });

    await engine.start("p1", "Build it", "/tmp");
    assert.ok(engine.getSession("p1"));

    const _respondPromise = engine.respond("p1", "Continue", "/tmp");
    const session = engine.getSession("p1");
    if (!session) assert.fail("Expected session");
    assert.strictEqual(session.status, "active");

    await engine.resetSession("p1", session.sessionId);
    assert.strictEqual(engine.getSession("p1"), undefined);
    assert.ok(respondCallSignal?.aborted);
    assert.strictEqual(runtimeStore.getRequirementsSessions("p1").length, 0);
  });
});
