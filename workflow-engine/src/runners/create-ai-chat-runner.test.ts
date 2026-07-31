import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskDefinition } from "../task-runner";
import {
  type AiChatModelCaller,
  createAiChatRunner,
} from "./create-ai-chat-runner";
import type { ToolCall } from "./tool-types";

function mockCaller(
  responses: { content: string; toolCalls?: ToolCall[] }[]
): AiChatModelCaller {
  let i = 0;
  return async (_prompt, _msgs, _tools, _signal) => {
    const r = responses[i];
    i++;
    if (!r) throw new Error("Unexpected extra model call");
    return r;
  };
}

describe("createAiChatRunner", () => {
  const dummyTask: TaskDefinition = {
    id: "test",
    label: "Test",
    role: "ai-chat",
    systemPrompt: "You are a helpful assistant.",
    tools: [],
  };

  it("completes on completion signal in content", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([{ content: "##COMPLETE##" }]),
      toolDefinitions: {},
      toolExecutors: {},
      completionSignal: "##COMPLETE##",
    });

    const result = await runner.run(dummyTask);
    assert.ok(
      (result.output as { content: string }).content.includes("##COMPLETE##")
    );
  });

  it("completes on a task-level completion signal", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([{ content: "REQUIREMENTS_COMPLETE" }]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    const result = await runner.run({
      ...dummyTask,
      completionSignal: "REQUIREMENTS_COMPLETE",
    });
    assert.ok(
      (result.output as { content: string }).content.includes(
        "REQUIREMENTS_COMPLETE"
      )
    );
  });

  it("completes on completion tool call", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "Submitting",
          toolCalls: [{ id: "c1", name: "submit_work", arguments: "{}" }],
        },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
      completionTool: "submit_work",
    });

    const result = await runner.run(dummyTask);
    assert.equal((result.output as { content: string }).content, "Submitting");
  });

  it("processes tool calls before pausing for input", async () => {
    const toolCalls: ToolCall[] = [
      { id: "c1", name: "read_file", arguments: '{"path":"test.txt"}' },
    ];
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        { content: "Let me check", toolCalls },
        { content: "##COMPLETE##" },
      ]),
      toolDefinitions: {
        read_file: {
          type: "function",
          function: {
            name: "read_file",
            description: "",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
      },
      toolExecutors: {
        read_file: async (call) => ({
          toolCallId: call.id,
          content: "file content",
          isError: false,
        }),
      },
      completionSignal: "##COMPLETE##",
    });

    const result = await runner.run(dummyTask);
    assert.ok(
      (result.output as { content: string }).content.includes("##COMPLETE##")
    );
  });

  it("accepts messages via sendMessage", async () => {
    let calls = 0;

    const modelCaller: AiChatModelCaller = async (
      _prompt,
      msgs,
      _tools,
      _signal
    ) => {
      calls++;
      if (calls === 1) {
        return { content: "How can I help?" };
      }
      if (calls === 2) {
        const hasUserMsg = msgs.some((m) => m.role === "user");
        return { content: hasUserMsg ? "##COMPLETE##" : "..." };
      }
      return { content: "##COMPLETE##" };
    };

    const runner = createAiChatRunner({
      modelCaller,
      toolDefinitions: {},
      toolExecutors: {},
      completionSignal: "##COMPLETE##",
    });

    const runPromise = runner.run(dummyTask);

    await new Promise((r) => setTimeout(r, 0));
    await runner.sendMessage?.("Hello!", "user");

    const result = await runPromise;
    assert.ok(
      (result.output as { content: string }).content.includes("##COMPLETE##")
    );
  });

  it("cancel aborts execution", async () => {
    const runner = createAiChatRunner({
      modelCaller: async (_prompt, _msgs, _tools, signal) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        });
      },
      toolDefinitions: {},
      toolExecutors: {},
    });

    const runPromise = runner.run(dummyTask);
    runner.cancel();
    await assert.rejects(() => runPromise, /Aborted/);
  });
});
