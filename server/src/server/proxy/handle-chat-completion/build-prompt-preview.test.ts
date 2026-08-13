import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "shared/message";
import { buildPromptPreview } from "./build-prompt-preview.ts";

describe("buildPromptPreview", () => {
  it("returns an empty string for no last message", () => {
    assert.equal(buildPromptPreview(undefined), "");
  });

  it("previews a tool call with its name and first argument", () => {
    const preview = buildPromptPreview({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "websearch",
            arguments: JSON.stringify({ query: "hive", limit: 5 }),
          },
        },
      ],
    } as Message);
    assert.equal(preview, 'tool: websearch query="hive"');
  });

  it("carries the whole tool-result text (not just its length)", () => {
    const text = JSON.stringify({ title: "Hive docs", snippet: "good result" });
    const preview = buildPromptPreview({
      role: "tool",
      content: text,
    } as Message);
    assert.equal(preview, `tool result: ${text}`);
  });

  it("labels an empty tool result without trailing content", () => {
    const preview = buildPromptPreview({
      role: "tool",
      content: "",
    } as Message);
    assert.equal(preview, "tool result");
  });

  it("truncates other messages to 120 characters", () => {
    const long = "x".repeat(200);
    const preview = buildPromptPreview({
      role: "user",
      content: long,
    } as Message);
    assert.equal(preview, long.slice(0, 120));
  });
});
