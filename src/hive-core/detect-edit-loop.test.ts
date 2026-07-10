import assert from "node:assert";
import { describe, it } from "node:test";
import type { Message } from "./message";
import { detectEditLoop } from "./detect-edit-loop";

function editAssistant(filePath: string, oldString: string): Message {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        type: "function",
        function: {
          name: "edit",
          arguments: JSON.stringify({
            filePath,
            oldString,
            newString: "replacement",
          }),
        },
      },
    ],
  };
}

function editFailure(toolCallId: string): Message {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content:
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
  };
}

function editSuccess(toolCallId: string): Message {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: "Edit applied successfully.",
  };
}

function readSuccess(_filePath: string): Message {
  return {
    role: "tool",
    tool_call_id: "read-1",
    content: `<content>file content here</content>`,
  };
}

function userMessage(text: string): Message {
  return { role: "user", content: text };
}

await describe("detectEditLoop", async () => {
  await it("returns null when no edit calls exist", () => {
    const messages = [
      userMessage("hello"),
      { role: "assistant", content: "hi" },
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });

  await it("returns null when below threshold (2 same-edit failures)", () => {
    const messages = [
      userMessage("update the file"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-1"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-2"),
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });

  await it("returns result when 3 consecutive same-edit failures", () => {
    const messages = [
      userMessage("update the file"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-1"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-2"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-3"),
    ];
    const result = detectEditLoop(messages);
    assert.ok(result !== null);
    assert.strictEqual(result.filePath, "/path/file.txt");
    assert.strictEqual(result.oldString, "old text");
  });

  await it("returns null when chain is broken by a successful edit", () => {
    const messages = [
      userMessage("update the file"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-1"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-2"),
      editAssistant("/path/file.txt", "different text"),
      editSuccess("call-3"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-4"),
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });

  await it("returns null when failures have different oldStrings", () => {
    const messages = [
      userMessage("update the file"),
      editAssistant("/path/file.txt", "old text A"),
      editFailure("call-1"),
      editAssistant("/path/file.txt", "old text B"),
      editFailure("call-2"),
      editAssistant("/path/file.txt", "old text C"),
      editFailure("call-3"),
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });

  await it("returns null when assistant sends multiple tool calls", () => {
    const multiToolAssistant: Message = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          function: {
            name: "edit",
            arguments: JSON.stringify({
              filePath: "/path/a.txt",
              oldString: "x",
            }),
          },
        },
        {
          type: "function",
          function: {
            name: "edit",
            arguments: JSON.stringify({
              filePath: "/path/b.txt",
              oldString: "y",
            }),
          },
        },
      ],
    };
    const messages = [
      userMessage("edit"),
      multiToolAssistant,
      editFailure("call-1"),
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });

  await it("returns null when non-edit tool call breaks the chain", () => {
    const messages = [
      userMessage("update the file"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-1"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-2"),
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ filePath: "/path/file.txt" }),
            },
          },
        ],
      },
      readSuccess("/path/file.txt"),
      editAssistant("/path/file.txt", "old text"),
      editFailure("call-4"),
    ];
    assert.strictEqual(detectEditLoop(messages), null);
  });
});
