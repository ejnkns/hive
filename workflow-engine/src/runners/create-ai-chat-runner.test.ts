import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskDefinition } from "../task-runner.ts";
import type { ChatMessage } from "../workflow-types.ts";
import {
  type AiChatModelCaller,
  createAiChatRunner,
} from "./create-ai-chat-runner.ts";
import {
  createStandardToolDefinitions,
  createStandardToolRegistry,
} from "./create-standard-tool-registry.ts";
import type { ToolCall } from "./tool-types.ts";

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

  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-ai-chat-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it("completes on a task-level completion tool call", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "Submitting",
          toolCalls: [{ id: "c1", name: "submit_work", arguments: "{}" }],
        },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    const result = await runner.run({
      ...dummyTask,
      completionTool: "submit_work",
    });
    assert.equal((result.output as { content: string }).content, "Submitting");
  });

  it("surfaces the completion tool arguments for gates", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "Already there",
          toolCalls: [
            {
              id: "c1",
              name: "complete_task",
              arguments: JSON.stringify({
                outcome: "already_satisfied",
                rationale: "nothing to do",
              }),
            },
          ],
        },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    const result = await runner.run({
      ...dummyTask,
      completionTool: "complete_task",
    });
    const output = result.output as {
      completion?: { outcome?: string };
    };
    assert.equal(output.completion?.outcome, "already_satisfied");
  });

  it("degrades to the transcript when completion arguments are malformed", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "Submitting",
          toolCalls: [{ id: "c1", name: "submit_work", arguments: "not json" }],
        },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
    });

    const result = await runner.run({
      ...dummyTask,
      completionTool: "submit_work",
    });
    const output = result.output as { completion?: Record<string, unknown> };
    assert.equal(output.completion?.outcome, undefined);
  });

  it("resolves an @instance workspacePath ref so tools operate in the instance workspace", async () => {
    const worktree = tempDir();
    const toolDefs = createStandardToolDefinitions();
    const toolExecs = createStandardToolRegistry();

    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "writing",
          toolCalls: [
            {
              id: "c1",
              name: "write_file",
              arguments: JSON.stringify({ path: "note.txt", content: "hi" }),
            },
          ],
        },
        { content: "##COMPLETE##" },
      ]),
      toolDefinitions: toolDefs,
      toolExecutors: toolExecs,
      workflowInstanceState: () => ({ worktreePath: worktree }),
      completionSignal: "##COMPLETE##",
    });

    await runner.run({
      ...dummyTask,
      workspacePath: "@instance:worktreePath",
      tools: ["write_file"],
    });

    assert.equal(readFileSync(join(worktree, "note.txt"), "utf-8"), "hi");
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

  it("waits for the first user message before calling the model with startOnUserInput", async () => {
    let calls = 0;
    const modelCaller: AiChatModelCaller = async (
      _prompt,
      msgs,
      _tools,
      _signal
    ) => {
      calls++;
      const hasUser = msgs.some((m) => m.role === "user");
      return { content: hasUser ? "##COMPLETE##" : "unexpected" };
    };

    const runner = createAiChatRunner({
      modelCaller,
      toolDefinitions: {},
      toolExecutors: {},
      completionSignal: "##COMPLETE##",
    });

    const runPromise = runner.run({ ...dummyTask, startOnUserInput: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 0, "no model call before the first user message");

    await runner.sendMessage?.("Hello!", "user");
    const result = await runPromise;
    assert.equal(calls, 1);
    assert.ok(
      (result.output as { content: string }).content.includes("##COMPLETE##")
    );
  });

  it("surfaces a throwing tool executor as a tool message instead of failing", async () => {
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        {
          content: "Let me read",
          toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }],
        },
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
        read_file: async () => {
          throw new Error("ENOENT: no such file");
        },
      },
      completionSignal: "##COMPLETE##",
    });

    const result = await runner.run(dummyTask);
    assert.ok(
      (result.output as { content: string }).content.includes("##COMPLETE##")
    );
    const messages = (result.output as { messages: unknown[] }).messages;
    assert.ok(
      messages.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          "content" in m &&
          String((m as { content: string }).content).includes("ENOENT")
      ),
      "tool failure should be surfaced to the model, not fatal"
    );
  });

  it("includes tool_calls and tool_call_id so providers accept tool-using conversations", async () => {
    let seenMessages: ChatMessage[] = [];
    const modelCaller: AiChatModelCaller = async (
      _prompt,
      msgs,
      _tools,
      _signal
    ) => {
      seenMessages = msgs;
      if (msgs.length <= 1) {
        return {
          content: "reading",
          toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }],
        };
      }
      return { content: "##COMPLETE##" };
    };

    const runner = createAiChatRunner({
      modelCaller,
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
          content: "ok",
          isError: false,
        }),
      },
      completionSignal: "##COMPLETE##",
    });

    await runner.run(dummyTask);

    const assistant = seenMessages.find(
      (m) => m.role === "assistant" && m.tool_calls !== undefined
    );
    const toolMsg = seenMessages.find((m) => m.role === "tool");
    assert.equal(assistant?.tool_calls?.[0]?.function.name, "read_file");
    assert.equal(assistant?.tool_calls?.[0]?.type, "function");
    assert.equal(toolMsg?.tool_call_id, "c1");
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

  it("syncs each transcript change through patchRunningTaskMessages", async () => {
    const snapshots: ChatMessage[][] = [];
    const runner = createAiChatRunner({
      modelCaller: mockCaller([
        { content: "Hi, how can I help?" },
        { content: "##COMPLETE##" },
      ]),
      toolDefinitions: {},
      toolExecutors: {},
      completionSignal: "##COMPLETE##",
      patchRunningTaskMessages: (messages) => snapshots.push([...messages]),
    });

    const runPromise = runner.run(dummyTask);
    await new Promise((r) => setTimeout(r, 0));
    await runner.sendMessage?.("I need a spec", "user");
    await runPromise;

    assert.ok(snapshots.length >= 2, "system + user + assistant should sync");
    assert.ok(
      snapshots.some((messages) =>
        messages.some((m) => m.role === "user" && m.content === "I need a spec")
      ),
      "the user message should be synced"
    );
    assert.ok(
      snapshots.some((messages) =>
        messages.some(
          (m) =>
            m.role === "assistant" &&
            m.content.toLowerCase().includes("how can i help")
        )
      ),
      "the assistant reply should be synced"
    );
  });

  it("injects inputFromInstanceState as the first user message", async () => {
    let seenMessages: ChatMessage[] = [];
    const runner = createAiChatRunner({
      modelCaller: async (_prompt, msgs, _tools, _signal) => {
        seenMessages = [...msgs];
        return { content: "##COMPLETE##" };
      },
      toolDefinitions: {},
      toolExecutors: {},
      workflowInstanceState: () => ({ ticket: { title: "Build the thing" } }),
      completionSignal: "##COMPLETE##",
    });

    await runner.run({ ...dummyTask, inputFromInstanceState: "ticket" });

    assert.equal(seenMessages.length, 2);
    assert.equal(seenMessages[0]?.role, "system");
    assert.equal(seenMessages[1]?.role, "user");
    assert.ok(seenMessages[1]?.content.includes("Build the thing"));
  });

  it("reports live model-call status through patchRunningTaskStatus", async () => {
    const statuses: string[] = [];
    const modelCaller: AiChatModelCaller = async (
      _prompt,
      _msgs,
      _tools,
      _signal,
      onStatus
    ) => {
      onStatus?.({
        stage: "dispatched",
        provider: "opencode-zen",
        model: "deepseek-v4-flash",
      });
      onStatus?.({ stage: "thinking" });
      onStatus?.({ stage: "streaming" });
      return { content: "Hi! ##DONE##" };
    };
    const runner = createAiChatRunner({
      modelCaller,
      toolDefinitions: {},
      toolExecutors: {},
      patchRunningTaskStatus: (status) => {
        statuses.push(
          status.stage === "dispatched"
            ? `${status.stage}:${status.provider}:${status.model}`
            : status.stage
        );
      },
    });

    await runner.run({
      ...dummyTask,
      startOnUserInput: false,
      completionSignal: "##DONE##",
    });

    // The loop reports routing before each call and complete after it; the
    // caller reports the dispatched node and the stream phases in between.
    assert.deepEqual(statuses, [
      "routing",
      "dispatched:opencode-zen:deepseek-v4-flash",
      "thinking",
      "streaming",
      "complete",
    ]);
  });
});
