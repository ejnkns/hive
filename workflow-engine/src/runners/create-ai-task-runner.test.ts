import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskDefinition } from "../task-runner.ts";
import type { ChatMessage } from "../workflow-types.ts";
import {
  type AiTaskModelCaller,
  createAiTaskRunner,
} from "./create-ai-task-runner.ts";
import {
  createStandardToolDefinitions,
  createStandardToolRegistry,
} from "./create-standard-tool-registry.ts";
import type { ToolCall, ToolContext } from "./tool-types.ts";

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

  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-ai-task-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
    assert.equal(ctx.workspacePath, "/repo");
  });

  it("resolves an @instance workspacePath ref so tools operate in the instance workspace", async () => {
    const worktree = tempDir();
    const toolDefs = createStandardToolDefinitions();
    const toolExecs = createStandardToolRegistry();

    const runner = createAiTaskRunner({
      modelCaller: mockCaller([
        {
          content: "writing",
          toolCalls: [
            {
              id: "c1",
              name: "write_file",
              arguments: JSON.stringify({ path: "note.txt", content: "hello" }),
            },
          ],
        },
        { content: "Done!" },
      ]),
      toolDefinitions: toolDefs,
      toolExecutors: toolExecs,
      workflowInstanceState: () => ({ worktreePath: worktree }),
    });

    await runner.run({
      ...dummyTask,
      workspacePath: "@instance:worktreePath",
      tools: ["write_file"],
    });

    assert.equal(readFileSync(join(worktree, "note.txt"), "utf-8"), "hello");
  });

  it("injects inputFromInstanceState as the first user message", async () => {
    let seenMessages: ChatMessage[] = [];
    const runner = createAiTaskRunner({
      modelCaller: async (_prompt, msgs, _tools, _signal) => {
        seenMessages = [...msgs];
        return { content: "Done!" };
      },
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({
        requirementsDraft: "# The requirements",
      }),
    });

    await runner.run({
      ...dummyTask,
      inputFromInstanceState: "requirementsDraft",
    });

    assert.equal(seenMessages.length, 1);
    assert.equal(seenMessages[0]?.role, "user");
    assert.equal(seenMessages[0]?.content, "# The requirements");
  });

  it("rejects a declared input missing from instance state before calling the model", async () => {
    let calls = 0;
    const runner = createAiTaskRunner({
      modelCaller: async () => {
        calls++;
        return { content: "Done!" };
      },
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({}),
    });

    await assert.rejects(
      () =>
        runner.run({
          ...dummyTask,
          inputFromInstanceState: "requirementsDraft",
        }),
      /declares inputFromInstanceState/
    );
    assert.equal(calls, 0, "no model call for a missing declared input");
  });

  it("fails fast without calling the model when the task has no prompt and no input", async () => {
    let calls = 0;
    const runner = createAiTaskRunner({
      modelCaller: async () => {
        calls++;
        return { content: "Hello!" };
      },
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({}),
    });

    await assert.rejects(
      () =>
        runner.run({
          id: "zombie",
          label: "Zombie",
          role: "ai-task",
        }),
      /no system prompt and no input/
    );
    assert.equal(
      calls,
      0,
      "the model must never be called with an empty prompt"
    );
  });

  it("fails fast without calling the model when a declared input is missing", async () => {
    let calls = 0;
    const runner = createAiTaskRunner({
      modelCaller: async () => {
        calls++;
        return { content: "Hello!" };
      },
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({}),
    });

    await assert.rejects(
      () =>
        runner.run({
          id: "triage",
          label: "Triage",
          role: "ai-task",
          systemPrompt: "Triage the ticket.",
          inputFromInstanceState: "description",
        }),
      /declares inputFromInstanceState .description. but the instance was created without it/
    );
    assert.equal(
      calls,
      0,
      "a declared-but-missing input must not spend a model call"
    );
  });

  it("runs with only a system prompt (no input message)", async () => {
    const runner = createAiTaskRunner({
      modelCaller: mockCaller([{ content: "Hello!" }]),
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({}),
    });

    const result = await runner.run({
      ...dummyTask,
    });
    assert.equal((result.output as { content: string }).content, "Hello!");
  });
});
