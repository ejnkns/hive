import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskDefinition } from "../task-runner";
import {
  type AiTaskModelCaller,
  createAiTaskRunner,
} from "./create-ai-task-runner";
import type { ToolCall, ToolContext } from "./tool-types";

function mockCaller(
  responses: { content: string; toolCalls?: ToolCall[] }[]
): AiTaskModelCaller {
  let i = 0;
  return async (_prompt, _msgs, _tools, _signal) => {
    const r = responses[i];
    i++;
    if (!r) throw new Error("Unexpected extra model call");
    return r;
  };
}

describe("createAiTaskRunner", () => {
  const dummyTask: TaskDefinition = {
    id: "test",
    label: "Test",
    role: "ai-task",
    systemPrompt: "You are a helpful assistant.",
  };

  it("returns model output when no tool calls", async () => {
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([{ content: "Hello!" }]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    const result = await runner.run(dummyTask);
    assert.equal((result.output as { content: string }).content, "Hello!");
  });

  it("processes tool calls and loops", async () => {
    const toolCalls: ToolCall[] = [
      {
        id: "call1",
        name: "test_tool",
        arguments: "{}",
      },
    ];
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([
        { content: "Using tool", toolCalls },
        { content: "Done!" },
      ]),
      toolDefinitions: {},
      toolExecutors: {
        test_tool: async (call) => ({
          toolCallId: call.id,
          content: "tool result",
          isError: false,
        }),
      },
    });

    const result = await runner.run(dummyTask);
    assert.equal((result.output as { content: string }).content, "Done!");
  });

  it("throws on iteration budget exhaustion", async () => {
    const runner = createAiTaskRunner({
      modelCaller: mockCaller(
        Array(100).fill({
          content: "",
          toolCalls: [{ id: "c", name: "test_tool", arguments: "{}" }],
        })
      ),
      toolDefinitions: {},
      toolExecutors: {
        test_tool: async (call) => ({
          toolCallId: call.id,
          content: "",
          isError: false,
        }),
      },
    });

    await assert.rejects(
      () => runner.run(dummyTask),
      /Iteration budget exhausted/
    );
  });

  it("completes on completion tool call and returns parsed arguments", async () => {
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([
        {
          content: "Submitting review",
          toolCalls: [
            {
              id: "c1",
              name: "submit_review",
              arguments: JSON.stringify({
                verdict: "approved",
                findings: [],
                verificationAssessment: { status: "sufficient", notes: "Ok" },
              }),
            },
          ],
        },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
      completionTool: "submit_review",
    });

    const result = await runner.run(dummyTask);
    const parsed = result.output as { verdict: string };
    assert.equal(parsed.verdict, "approved");
  });

  it("cancel aborts execution", async () => {
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([{ content: "Hello!" }]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    runner.cancel();
    await assert.rejects(() => runner.run(dummyTask), /aborted/);
  });

  it("passes basePath to tool executors", async () => {
    let resolveCtx: (ctx: ToolContext) => void = () => {};
    const ctxPromise = new Promise<ToolContext>((resolve) => {
      resolveCtx = resolve;
    });
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([
        {
          content: "tool",
          toolCalls: [{ id: "c", name: "test_tool", arguments: "{}" }],
        },
        { content: "Done!" },
      ]),
      toolDefinitions: {},
      toolExecutors: {
        test_tool: async (call, ctx) => {
          resolveCtx(ctx);
          return {
            toolCallId: call.id,
            content: "ok",
            isError: false,
          };
        },
      },
      basePath: "/repo",
    });

    await runner.run({ ...dummyTask, tools: ["test_tool"] });

    const ctx = await ctxPromise;
    assert.equal(ctx.basePath, "/repo");
    assert.equal(ctx.workspacePath, process.cwd());
  });
});
