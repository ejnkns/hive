import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { RequirementsFeedback } from "shared/board-types";
import type { Message } from "shared/message";
import { createRequirementsSessionManager, extractSpec } from "./devise-engine";
import type {
  AgentModelCaller,
  AgentModelResponse,
} from "./devise-engine/create-devise-model-caller";
import { REQUIREMENTS_AGENT_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";
import type { ToolCall } from "./devise-engine/devise-tools";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";

function createMockCaller(responses: AgentModelResponse[]): AgentModelCaller {
  let index = 0;
  return {
    call: async (
      _messages: Message[],
      _workspacePath: string,
      _includeTools: boolean
    ): Promise<AgentModelResponse> => {
      const response = responses[index];
      if (!response) throw new Error("No more mock responses");
      index++;
      return response;
    },
  };
}

function emptyResponse(content: string): AgentModelResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function completionResponse(): AgentModelResponse {
  return {
    content: "# Requirements\n\n## Overview\nTest app\n\nREQUIREMENTS_COMPLETE",
    toolCalls: [],
    finishReason: "stop",
  };
}

function draftResponse(): AgentModelResponse {
  return toolResponse("", [
    {
      id: "draft-1",
      name: "update_requirements_draft",
      arguments: JSON.stringify({
        content: "# Requirements\n\n## Overview\nTest app",
      }),
    },
  ]);
}

function toolResponse(
  content: string,
  toolCalls: ToolCall[]
): AgentModelResponse {
  return { content, toolCalls, finishReason: "tool_calls" };
}

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-devise-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
  return dir;
}

describe("REQUIREMENTS_AGENT_SYSTEM_PROMPT", () => {
  it("is non-empty", () => {
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.length > 100);
  });

  it("contains key instructions", () => {
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("ONE question"));
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("RECOMMENDED ANSWER"));
    assert.ok(REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("BREADTH-FIRST"));
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("Codebase exploration")
    );
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes("REQUIREMENTS_COMPLETE")
    );
    assert.ok(
      REQUIREMENTS_AGENT_SYSTEM_PROMPT.includes(
        "requirements analyst, not an implementer"
      )
    );
  });
});

describe("extractSpec", () => {
  it("strips REQUIREMENTS_COMPLETE signal and trims", () => {
    const content = "before\nREQUIREMENTS_COMPLETE\n# Spec\n\n## Hello";
    const result = extractSpec(content);
    assert.strictEqual(result, "before\n\n# Spec\n\n## Hello");
  });

  it("strips multiple occurrences of the signal", () => {
    const content = "REQUIREMENTS_COMPLETE\n\n# Spec\n\nREQUIREMENTS_COMPLETE";
    assert.strictEqual(extractSpec(content), "# Spec");
  });

  it("returns trimmed content when no signal present", () => {
    assert.strictEqual(extractSpec("  # Just text  "), "# Just text");
  });
});

describe("RequirementsSessionManager", () => {
  it("start creates session and returns model's first question", async () => {
    const caller = createMockCaller([emptyResponse("What are you building?")]);
    const engine = createRequirementsSessionManager(caller);

    const result = await engine.start("test", "Make a todo app", "/tmp");

    assert.strictEqual(result.question, "What are you building?");
  });

  it("respond returns next question from model", async () => {
    const caller = createMockCaller([
      emptyResponse("First question"),
      emptyResponse("What framework?"),
    ]);
    const engine = createRequirementsSessionManager(caller);

    await engine.start("test", "Make an app", "/tmp");
    const result = await engine.respond("test", "React", "/tmp");

    assert.strictEqual(result.type, "question");
    if (result.type === "question") {
      assert.strictEqual(result.question, "What framework?");
    }
  });

  it("detects completion and returns spec", async () => {
    const caller = createMockCaller([
      emptyResponse("First question"),
      draftResponse(),
      completionResponse(),
    ]);
    const engine = createRequirementsSessionManager(caller);

    await engine.start("test", "Make an app", "/tmp");
    const result = await engine.respond("test", "done", "/tmp");

    assert.strictEqual(result.type, "complete");
    if (result.type === "complete") {
      assert.ok(result.spec.includes("# Requirements"));
      assert.ok(result.spec.includes("Test app"));
      assert.ok(!result.spec.includes("REQUIREMENTS_COMPLETE"));
    }
  });

  it("respond throws for unknown project", async () => {
    const engine = createRequirementsSessionManager();
    await assert.rejects(
      () => engine.respond("unknown", "answer", "/tmp"),
      /No active Requirements Session/
    );
  });

  it("clears session after completion", async () => {
    const caller = createMockCaller([
      emptyResponse("Q1"),
      draftResponse(),
      completionResponse(),
    ]);
    const engine = createRequirementsSessionManager(caller);

    await engine.start("test", "Make an app", "/tmp");
    await engine.respond("test", "done", "/tmp");

    await assert.rejects(
      () => engine.respond("test", "more", "/tmp"),
      /No active Requirements Session/
    );
  });

  it("includes system prompt in first model call", async () => {
    let capturedMessages: Message[] = [];
    const caller: AgentModelCaller = {
      call: async (messages: Message[]): Promise<AgentModelResponse> => {
        capturedMessages = messages;
        return emptyResponse("Ok");
      },
    };
    const engine = createRequirementsSessionManager(caller);

    await engine.start("test", "Build X", "/tmp");

    const systemMsg = capturedMessages.find((m) => m.role === "system");
    assert.ok(systemMsg, "system message present");
    assert.ok(systemMsg?.content.includes("ONE question"));
    const userMsg = capturedMessages.find((m) => m.role === "user");
    assert.ok(userMsg, "user message present");
    assert.strictEqual(userMsg?.content, "Build X");
  });

  it("keeps draft requirements in the session without changing canonical requirements", async () => {
    const workspace = createTempWorkspace();
    mkdirSync(join(workspace, ".hive"), { recursive: true });
    writeFileSync(join(workspace, ".hive", "requirements.md"), "# Canonical");
    const caller = createMockCaller([draftResponse(), emptyResponse("Next?")]);
    const engine = createRequirementsSessionManager(caller);

    const result = await engine.start("test", "Revise", workspace);

    assert.strictEqual(
      result.draftRequirements,
      "# Requirements\n\n## Overview\nTest app"
    );
    assert.strictEqual(
      engine.getSession("test")?.draftRequirements,
      result.draftRequirements
    );
    assert.strictEqual(
      readFileSync(join(workspace, ".hive", "requirements.md"), "utf-8"),
      "# Canonical"
    );
  });

  it("publishes each requirements draft before the model turn completes", async () => {
    const workspace = createTempWorkspace();
    let callCount = 0;
    let finishModelTurn: (() => void) | undefined;
    const modelTurnCanFinish = new Promise<void>((resolve) => {
      finishModelTurn = resolve;
    });
    let receivedDraft: ((content: string) => void) | undefined;
    const draftPublished = new Promise<string>((resolve) => {
      receivedDraft = resolve;
    });
    const caller: AgentModelCaller = {
      async call() {
        callCount += 1;
        if (callCount === 1) return draftResponse();
        await modelTurnCanFinish;
        return emptyResponse("Next question");
      },
    };
    const engine = createRequirementsSessionManager(
      caller,
      undefined,
      (update) => {
        receivedDraft?.(update.content);
      }
    );

    const started = engine.start("test", "Build", workspace);
    assert.equal(
      await draftPublished,
      "# Requirements\n\n## Overview\nTest app"
    );
    finishModelTurn?.();
    await started;
  });

  it("allows only one active requirements workflow per project", async () => {
    const caller = createMockCaller([emptyResponse("Question")]);
    const engine = createRequirementsSessionManager(caller);
    await engine.start("test", "Project session", "/tmp");

    await assert.rejects(
      () => engine.startCard("test", "card-1", "Card session", "/tmp"),
      /already has an active requirements workflow/
    );
  });

  it("blocks competing planning while allowing an explicit proposal replacement", async () => {
    const workspace = createTempWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    runtimeStore.savePlanningProposal({
      id: "proposal-1",
      projectId: "test",
      status: "pending",
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      projectRevision: null,
      runKind: "requirements_reconciliation",
      proposedRequirements: "# Proposed",
      changes: [],
      createdAt: "2026-07-20T00:00:00.000Z",
    });
    const engine = createRequirementsSessionManager(
      createMockCaller([emptyResponse("What should change?")]),
      runtimeStore
    );

    await assert.rejects(
      () => engine.start("test", "Competing workflow", workspace),
      /open requirements-changing workflow/
    );
    const replacement = await engine.startRevision(
      "test",
      "Replace the pending proposal",
      workspace,
      "proposal-1"
    );
    assert.equal(replacement.question, "What should change?");
  });

  it("isolates Idea Elaboration and Requirements Repair context", async () => {
    const workspace = createTempWorkspace();
    mkdirSync(join(workspace, ".hive"), { recursive: true });
    writeFileSync(
      join(workspace, ".hive", "requirements.md"),
      "# Canonical requirements"
    );
    let ideaMessages: Message[] = [];
    const ideaEngine = createRequirementsSessionManager({
      async call(messages) {
        ideaMessages = structuredClone(messages);
        return emptyResponse("What outcome should this Idea provide?");
      },
    });

    await ideaEngine.startIdea(
      "test",
      {
        id: "idea-1",
        title: "Dark mode",
        brief: "Support a dark appearance",
        createdAt: "2026-07-20T00:00:00.000Z",
      },
      "Make it comfortable at night",
      workspace
    );

    assert.equal(
      ideaEngine.getIdeaSession("test", "idea-1")?.kind,
      "idea_elaboration"
    );
    assert.ok(
      ideaMessages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes('"title": "Dark mode"')
      )
    );
    assert.ok(
      ideaMessages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("# Canonical requirements")
      )
    );

    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "feedback-1",
      projectId: "test",
      status: "pending",
      projectRevision: null,
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      proposedRequirements: "# Draft requiring repair",
      sourceIdeaId: "idea-1",
      createdAt: "2026-07-20T00:01:00.000Z",
      issues: [
        {
          requirementRefs: ["FR-1"],
          category: "missing_decision",
          explanation: "A choice is missing.",
          evidence: [],
          decisionNeeded: "Choose a behavior.",
          recommendation: "Preserve the existing behavior.",
        },
      ],
    };
    let repairMessages: Message[] = [];
    const repairRuntimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".repair-runtime")
    );
    repairRuntimeStore.saveRequirementsFeedback(feedback);
    const repairEngine = createRequirementsSessionManager(
      {
        async call(messages) {
          repairMessages = structuredClone(messages);
          return emptyResponse("Which behavior should be canonical?");
        },
      },
      repairRuntimeStore
    );

    await repairEngine.startRepair("test", feedback, workspace, {
      id: "idea-1",
      title: "Dark mode",
      brief: "Support a dark appearance",
      createdAt: "2026-07-20T00:00:00.000Z",
    });

    assert.equal(repairEngine.getSession("test")?.kind, "requirements_repair");
    assert.equal(repairEngine.getSession("test")?.sourceIdeaId, "idea-1");
    assert.equal(
      repairRuntimeStore.getRequirementsFeedback("test", feedback.id)?.status,
      "repairing"
    );
    assert.ok(
      repairMessages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("# Draft requiring repair") &&
          message.content.includes("missing_decision")
      )
    );
    assert.ok(
      repairMessages.some(
        (message) =>
          message.role === "system" && message.content.includes("Dark mode")
      )
    );
  });

  it("restores a persisted session after the engine restarts", async () => {
    const workspace = createTempWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const firstEngine = createRequirementsSessionManager(
      createMockCaller([draftResponse(), emptyResponse("Next question")]),
      runtimeStore
    );
    await firstEngine.start("test", "Build it", workspace);

    const restartedEngine = createRequirementsSessionManager(
      undefined,
      runtimeStore
    );

    assert.strictEqual(
      restartedEngine.getSession("test")?.draftRequirements,
      "# Requirements\n\n## Overview\nTest app"
    );
    assert.strictEqual(restartedEngine.getSession("test")?.status, "active");
  });

  it("retires a completed session after it is submitted for planning", async () => {
    const workspace = createTempWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const engine = createRequirementsSessionManager(
      createMockCaller([
        emptyResponse("What should this project do?"),
        draftResponse(),
        emptyResponse(
          "REQUIREMENTS_COMPLETE\n```markdown\n# Requirements\n```"
        ),
      ]),
      runtimeStore
    );

    await engine.start("test", "Build it", workspace);
    await engine.respond("test", "That is complete", workspace);
    const session = engine.getSession("test");
    assert.equal(session?.status, "complete");

    engine.submitForPlanning("test", session!.sessionId, "proposal-1");

    assert.deepEqual(
      {
        status: engine.getSession("test")?.status,
        planningOutcomeId: engine.getSession("test")?.planningOutcomeId,
      },
      { status: "submitted", planningOutcomeId: "proposal-1" }
    );
    await assert.rejects(
      () => engine.respond("test", "Change it again", workspace),
      /No active Requirements Session/
    );
    assert.equal(
      runtimeStore.getRequirementsSessions("test").at(-1)?.status,
      "submitted"
    );
  });

  it("runs tool calls in loop before returning question", async () => {
    const workspace = createTempWorkspace();

    let toolCalled = false;
    const caller: AgentModelCaller = {
      call: async (
        _messages: Message[],
        _ws: string,
        _includeTools: boolean
      ): Promise<AgentModelResponse> => {
        if (!toolCalled) {
          toolCalled = true;
          return toolResponse("", [
            {
              id: "tc1",
              name: "read_file",
              arguments: '{"path":"package.json"}',
            },
          ]);
        }
        return emptyResponse(
          "I see the codebase uses TypeScript. What feature?"
        );
      },
    };

    const engine = createRequirementsSessionManager(caller);
    await engine.start("test", "Add feature", workspace);
    const result = await engine.respond("test", "Proceed", workspace);

    assert.strictEqual(result.type, "question");
    if (result.type === "question") {
      assert.ok(result.question.includes("TypeScript"));
    }
    assert.strictEqual(toolCalled, true);
  });

  it("limits tool-call rounds to prevent infinite loops", async () => {
    const workspace = createTempWorkspace();

    let respondCallCount = 0;
    const caller: AgentModelCaller = {
      call: async (): Promise<AgentModelResponse> => {
        respondCallCount++;
        return toolResponse("", [
          {
            id: `tc${respondCallCount}`,
            name: "list_directory",
            arguments: '{"path":"."}',
          },
        ]);
      },
    };

    const engine = createRequirementsSessionManager(caller);
    // start will loop 10 times, then respond loops 10 times.
    // We reset the counter after start to measure only respond.
    await engine.start("test", "Build", workspace);
    respondCallCount = 0;

    const result = await engine.respond("test", "Go", workspace);

    assert.strictEqual(result.type, "question");
    if (result.type === "question") {
      assert.strictEqual(result.question, "");
    }
    assert.strictEqual(respondCallCount, 10);
  });
});
