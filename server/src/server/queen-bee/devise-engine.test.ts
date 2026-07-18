import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Message } from "shared/message";
import { createDeviseEngine, extractSpec } from "./devise-engine";
import type {
  DeviseModelCaller,
  DeviseModelResponse,
} from "./devise-engine/create-devise-model-caller";
import { DEVISE_SYSTEM_PROMPT } from "./devise-engine/devise-system-prompt";
import type { ToolCall } from "./devise-engine/devise-tools";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";

function createMockCaller(responses: DeviseModelResponse[]): DeviseModelCaller {
  let index = 0;
  return {
    call: async (
      _messages: Message[],
      _workspacePath: string,
      _includeTools: boolean
    ): Promise<DeviseModelResponse> => {
      const response = responses[index];
      if (!response) throw new Error("No more mock responses");
      index++;
      return response;
    },
  };
}

function emptyResponse(content: string): DeviseModelResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function completionResponse(): DeviseModelResponse {
  return {
    content: "# Requirements\n\n## Overview\nTest app\n\nREQUIREMENTS_COMPLETE",
    toolCalls: [],
    finishReason: "stop",
  };
}

function draftResponse(): DeviseModelResponse {
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
): DeviseModelResponse {
  return { content, toolCalls, finishReason: "tool_calls" };
}

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-devise-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
  return dir;
}

describe("DEVISE_SYSTEM_PROMPT", () => {
  it("is non-empty", () => {
    assert.ok(DEVISE_SYSTEM_PROMPT.length > 100);
  });

  it("contains key instructions", () => {
    assert.ok(DEVISE_SYSTEM_PROMPT.includes("ONE question"));
    assert.ok(DEVISE_SYSTEM_PROMPT.includes("RECOMMENDED ANSWER"));
    assert.ok(DEVISE_SYSTEM_PROMPT.includes("BREADTH-FIRST"));
    assert.ok(DEVISE_SYSTEM_PROMPT.includes("Codebase exploration"));
    assert.ok(DEVISE_SYSTEM_PROMPT.includes("REQUIREMENTS_COMPLETE"));
    assert.ok(
      DEVISE_SYSTEM_PROMPT.includes("requirements analyst, not an implementer")
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

describe("DeviseEngine", () => {
  it("start creates session and returns model's first question", async () => {
    const caller = createMockCaller([emptyResponse("What are you building?")]);
    const engine = createDeviseEngine(caller);

    const result = await engine.start("test", "Make a todo app", "/tmp");

    assert.strictEqual(result.question, "What are you building?");
  });

  it("respond returns next question from model", async () => {
    const caller = createMockCaller([
      emptyResponse("First question"),
      emptyResponse("What framework?"),
    ]);
    const engine = createDeviseEngine(caller);

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
    const engine = createDeviseEngine(caller);

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
    const engine = createDeviseEngine();
    await assert.rejects(
      () => engine.respond("unknown", "answer", "/tmp"),
      /No active devise session/
    );
  });

  it("clears session after completion", async () => {
    const caller = createMockCaller([
      emptyResponse("Q1"),
      draftResponse(),
      completionResponse(),
    ]);
    const engine = createDeviseEngine(caller);

    await engine.start("test", "Make an app", "/tmp");
    await engine.respond("test", "done", "/tmp");

    await assert.rejects(
      () => engine.respond("test", "more", "/tmp"),
      /No active devise session/
    );
  });

  it("includes system prompt in first model call", async () => {
    let capturedMessages: Message[] = [];
    const caller: DeviseModelCaller = {
      call: async (messages: Message[]): Promise<DeviseModelResponse> => {
        capturedMessages = messages;
        return emptyResponse("Ok");
      },
    };
    const engine = createDeviseEngine(caller);

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
    const engine = createDeviseEngine(caller);

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

  it("allows only one active Devise Agent session per project", async () => {
    const caller = createMockCaller([emptyResponse("Question")]);
    const engine = createDeviseEngine(caller);
    await engine.start("test", "Project session", "/tmp");

    await assert.rejects(
      () => engine.startCard("test", "card-1", "Card session", "/tmp"),
      /already has an active Devise Agent session/
    );
  });

  it("restores a persisted session after the engine restarts", async () => {
    const workspace = createTempWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(
      join(workspace, ".runtime")
    );
    const firstEngine = createDeviseEngine(
      createMockCaller([draftResponse(), emptyResponse("Next question")]),
      runtimeStore
    );
    await firstEngine.start("test", "Build it", workspace);

    const restartedEngine = createDeviseEngine(undefined, runtimeStore);

    assert.strictEqual(
      restartedEngine.getSession("test")?.draftRequirements,
      "# Requirements\n\n## Overview\nTest app"
    );
    assert.strictEqual(restartedEngine.getSession("test")?.status, "active");
  });

  it("runs tool calls in loop before returning question", async () => {
    const workspace = createTempWorkspace();

    let toolCalled = false;
    const caller: DeviseModelCaller = {
      call: async (
        _messages: Message[],
        _ws: string,
        _includeTools: boolean
      ): Promise<DeviseModelResponse> => {
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

    const engine = createDeviseEngine(caller);
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
    const caller: DeviseModelCaller = {
      call: async (): Promise<DeviseModelResponse> => {
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

    const engine = createDeviseEngine(caller);
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
