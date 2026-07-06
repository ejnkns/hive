import assert from "node:assert";
import { describe, it } from "node:test";
import type { Message } from "../hive-core";
import { detectToolLoop } from "./detect-tool-loop";

function toolAssistant(
  toolName: string,
  args: Record<string, unknown>,
  callId: string
): Message {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        type: "function",
        id: callId,
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}

function toolResponse(callId: string, content: string): Message {
  return {
    role: "tool",
    tool_call_id: callId,
    content,
  };
}

function userMessage(text: string): Message {
  return { role: "user", content: text };
}

await describe("detectToolLoop", async () => {
  await it("returns null when no tool calls exist", () => {
    const messages = [
      userMessage("hello"),
      { role: "assistant", content: "hi" },
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("returns null when below threshold (2 same tool calls)", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick" }, "call-1"),
      toolResponse("call-1", "file.ts:10"),
      toolAssistant("grep", { pattern: "onClick" }, "call-2"),
      toolResponse("call-2", "file.ts:10"),
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("returns result when 3 consecutive same tool calls succeed", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick|onChange" }, "call-1"),
      toolResponse("call-1", "results..."),
      toolAssistant("grep", { pattern: "onClick|onChange" }, "call-2"),
      toolResponse("call-2", "results..."),
      toolAssistant("grep", { pattern: "onClick|onChange" }, "call-3"),
      toolResponse("call-3", "results..."),
    ];
    const result = detectToolLoop(messages);
    assert.ok(result !== null);
    assert.strictEqual(result.toolName, "grep");
    assert.strictEqual(
      result.arguments,
      JSON.stringify({ pattern: "onClick|onChange" })
    );
  });

  await it("returns result when 3 consecutive same tool calls fail", () => {
    const messages = [
      userMessage("edit"),
      toolAssistant("edit", { filePath: "/a.txt", oldString: "x" }, "call-1"),
      toolResponse("call-1", "Could not find oldString in the file."),
      toolAssistant("edit", { filePath: "/a.txt", oldString: "x" }, "call-2"),
      toolResponse("call-2", "Could not find oldString in the file."),
      toolAssistant("edit", { filePath: "/a.txt", oldString: "x" }, "call-3"),
      toolResponse("call-3", "Could not find oldString in the file."),
    ];
    const result = detectToolLoop(messages);
    assert.ok(result !== null);
    assert.strictEqual(result.toolName, "edit");
  });

  await it("detects a loop when identical tool calls recur after a different tool in between", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick" }, "call-1"),
      toolResponse("call-1", "results..."),
      toolAssistant("grep", { pattern: "onClick" }, "call-2"),
      toolResponse("call-2", "results..."),
      toolAssistant("read", { filePath: "/a.txt" }, "call-3"),
      toolResponse("call-3", "file content"),
      toolAssistant("grep", { pattern: "onClick" }, "call-4"),
      toolResponse("call-4", "results..."),
    ];
    const result = detectToolLoop(messages);
    assert.ok(result !== null);
    assert.strictEqual(result.toolName, "grep");
  });

  await it("returns null when only 2 identical calls exist at tail before a different call", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick" }, "call-1"),
      toolResponse("call-1", "results..."),
      toolAssistant("grep", { pattern: "onClick" }, "call-2"),
      toolResponse("call-2", "results..."),
      toolAssistant("grep", { pattern: "onChange" }, "call-3"),
      toolResponse("call-3", "results..."),
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("returns null when assistant sends multiple tool calls", () => {
    const multiToolAssistant: Message = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          function: {
            name: "grep",
            arguments: JSON.stringify({ pattern: "x" }),
          },
        },
        {
          type: "function",
          function: {
            name: "read",
            arguments: JSON.stringify({ filePath: "/a.txt" }),
          },
        },
      ],
    };
    const messages = [
      userMessage("search"),
      multiToolAssistant,
      toolResponse("call-1", "results"),
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("returns null when tool call has no function name", () => {
    const badAssistant: Message = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          function: {
            arguments: JSON.stringify({ pattern: "x" }),
          },
        },
      ],
    };
    const messages = [
      userMessage("search"),
      badAssistant,
      toolResponse("call-1", "results"),
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("handles tool calls with empty arguments", () => {
    const messages = [
      userMessage("go"),
      toolAssistant("ls", {}, "call-1"),
      toolResponse("call-1", "done"),
      toolAssistant("ls", {}, "call-2"),
      toolResponse("call-2", "done"),
      toolAssistant("ls", {}, "call-3"),
      toolResponse("call-3", "done"),
    ];
    const result = detectToolLoop(messages);
    assert.ok(result !== null);
    assert.strictEqual(result.toolName, "ls");
    assert.strictEqual(result.arguments, "{}");
  });

  await it("returns null when chain is interrupted by user message at end", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick" }, "call-1"),
      toolResponse("call-1", "results..."),
      toolAssistant("grep", { pattern: "onClick" }, "call-2"),
      toolResponse("call-2", "results..."),
      userMessage("stop that"),
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });

  await it("returns null when assistant final message has no tool calls", () => {
    const messages = [
      userMessage("search"),
      toolAssistant("grep", { pattern: "onClick" }, "call-1"),
      toolResponse("call-1", "results..."),
      toolAssistant("grep", { pattern: "onClick" }, "call-2"),
      toolResponse("call-2", "results..."),
      { role: "assistant", content: "here are the results" },
    ];
    assert.strictEqual(detectToolLoop(messages), null);
  });
});
