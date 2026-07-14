import assert from "node:assert";
import { describe, it } from "node:test";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
} from "../tools/tool";
import { orchestrate } from "./orchestrate";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelCaller,
  OrchestrationConfig,
} from "./types";

function createMockModelCaller(responses: CompletionResponse[]): ModelCaller {
  let callIndex = 0;
  return {
    complete: async (
      _request: CompletionRequest
    ): Promise<CompletionResponse> => {
      const response = responses[callIndex];
      callIndex++;
      return response;
    },
  };
}

function createMockToolRegistry(
  results: Map<string, ToolResult>,
  definitions: ToolDefinition[] = []
): ToolRegistry {
  return {
    getDefinitions: () => definitions,
    execute: async (
      toolCall: ToolCall,
      _context: ToolExecutionContext
    ): Promise<ToolResult> => {
      const result = results.get(toolCall.id);
      if (!result) {
        return {
          toolCallId: toolCall.id,
          content: `unknown tool: ${toolCall.name}`,
          isError: true,
        };
      }
      return result;
    },
  };
}

function completionResponse(body: Record<string, unknown>): CompletionResponse {
  return {
    status: 200,
    ok: true,
    body: JSON.stringify(body),
    provider: "test-provider",
    model: "test-model",
  };
}

function toolCallResponse(
  calls: { id: string; name: string; args: string }[],
  content = ""
): CompletionResponse {
  return completionResponse({
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
  });
}

function stopResponse(content: string): CompletionResponse {
  return completionResponse({
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  });
}

const TEST_CONTEXT: ToolExecutionContext = {
  sessionId: "test-session",
  workspacePath: "/tmp/test-workspace",
};

await describe("orchestrate", async () => {
  await it("returns immediately when model responds with stop and no tool calls", async () => {
    const modelCaller = createMockModelCaller([
      stopResponse("Hello! How can I help?"),
    ]);
    const toolRegistry = createMockToolRegistry(new Map());

    const config: OrchestrationConfig = {
      messages: [{ role: "user", content: "Hi" }],
      toolRegistry,
      toolContext: TEST_CONTEXT,
    };

    const result = await orchestrate(config, modelCaller);

    assert.strictEqual(result.finishReason, "stop");
    assert.strictEqual(result.finalContent, "Hello! How can I help?");
    assert.strictEqual(result.iterations, 1);
    assert.strictEqual(result.messages.length, 2);
  });

  await it("executes tool calls and loops until stop", async () => {
    const modelCaller = createMockModelCaller([
      toolCallResponse(
        [{ id: "call-1", name: "read_file", args: '{"path":"/foo"}' }],
        "Let me read that."
      ),
      stopResponse("The file contains hello world."),
    ]);
    const toolRegistry = createMockToolRegistry(
      new Map([
        [
          "call-1",
          { toolCallId: "call-1", content: "hello world", isError: false },
        ],
      ])
    );

    const config: OrchestrationConfig = {
      messages: [{ role: "user", content: "Read /foo" }],
      toolRegistry,
      toolContext: TEST_CONTEXT,
    };

    const result = await orchestrate(config, modelCaller);

    assert.strictEqual(result.finishReason, "stop");
    assert.strictEqual(result.finalContent, "The file contains hello world.");
    assert.strictEqual(result.iterations, 2);
    assert.strictEqual(result.messages.length, 4);
    assert.strictEqual(result.messages[1].role, "assistant");
    assert.strictEqual(result.messages[2].role, "tool");
    assert.strictEqual(result.messages[2].tool_call_id, "call-1");
    assert.strictEqual(result.messages[2].content, "hello world");
  });

  await it("executes multiple tool calls in a single turn", async () => {
    const modelCaller = createMockModelCaller([
      toolCallResponse([
        { id: "call-1", name: "read_file", args: '{"path":"/a"}' },
        { id: "call-2", name: "read_file", args: '{"path":"/b"}' },
      ]),
      stopResponse("Both files read."),
    ]);
    const toolRegistry = createMockToolRegistry(
      new Map([
        [
          "call-1",
          { toolCallId: "call-1", content: "contents of A", isError: false },
        ],
        [
          "call-2",
          { toolCallId: "call-2", content: "contents of B", isError: false },
        ],
      ])
    );

    const result = await orchestrate(
      {
        messages: [{ role: "user", content: "Read both" }],
        toolRegistry,
        toolContext: TEST_CONTEXT,
      },
      modelCaller
    );

    assert.strictEqual(result.iterations, 2);
    assert.strictEqual(result.messages.length, 5);
    assert.strictEqual(result.messages[2].role, "tool");
    assert.strictEqual(result.messages[2].content, "contents of A");
    assert.strictEqual(result.messages[3].role, "tool");
    assert.strictEqual(result.messages[3].content, "contents of B");
  });

  await it("returns max-iterations when loop does not terminate", async () => {
    const infiniteToolCall = toolCallResponse([
      { id: "call-1", name: "loop", args: "{}" },
    ]);
    const modelCaller = createMockModelCaller(Array(20).fill(infiniteToolCall));
    const toolRegistry = createMockToolRegistry(
      new Map([
        [
          "call-1",
          { toolCallId: "call-1", content: "looping", isError: false },
        ],
      ])
    );

    const result = await orchestrate(
      {
        messages: [{ role: "user", content: "loop" }],
        toolRegistry,
        toolContext: TEST_CONTEXT,
        maxIterations: 3,
      },
      modelCaller
    );

    assert.strictEqual(result.finishReason, "max-iterations");
    assert.strictEqual(result.iterations, 3);
  });

  await it("returns error when model call fails", async () => {
    const modelCaller = createMockModelCaller([
      {
        status: 503,
        ok: false,
        body: "All providers failed",
        provider: null,
        model: null,
      },
    ]);
    const toolRegistry = createMockToolRegistry(new Map());

    const result = await orchestrate(
      {
        messages: [{ role: "user", content: "Hi" }],
        toolRegistry,
        toolContext: TEST_CONTEXT,
      },
      modelCaller
    );

    assert.strictEqual(result.finishReason, "error");
    assert.strictEqual(result.error, "All providers failed");
    assert.strictEqual(result.iterations, 1);
  });

  await it("does not mutate the input messages array", async () => {
    const modelCaller = createMockModelCaller([stopResponse("done")]);
    const toolRegistry = createMockToolRegistry(new Map());
    const inputMessages = [{ role: "user", content: "Hi" }];

    await orchestrate(
      {
        messages: inputMessages,
        toolRegistry,
        toolContext: TEST_CONTEXT,
      },
      modelCaller
    );

    assert.strictEqual(inputMessages.length, 1);
  });
});
