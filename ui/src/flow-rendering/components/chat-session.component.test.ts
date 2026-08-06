import { describe, expect, it } from "vitest";
import type { ChatMessage } from "workflow-engine/workflow-types";
import {
  mount,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils";
import { ChatSession } from "./chat-session";

const messages: ChatMessage[] = [
  { role: "user", content: "what's the plan?", tool_calls: undefined },
  {
    role: "assistant",
    content: "Let me look.",
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "search_code", arguments: "{}" },
      },
    ],
  },
  { role: "tool", content: '{"result":"ok"}', tool_calls: undefined },
];

describe("ChatSession", () => {
  it("renders message bodies and tool-call chips", async () => {
    const el = await mount(Object.assign(new ChatSession(), { messages }));
    await settle(shadowRootOf(el));
    const chips = queryAllDeep(el, ".tool-chip").map(
      (chip) => chip.textContent
    );
    expect(chips).toEqual(["search_code"]);
    // user and assistant bodies render through markdown-view
    expect(queryAllDeep(el, "markdown-view").length).toBeGreaterThan(0);
  });

  it("disables Send while the input is empty", async () => {
    const el = await mount(Object.assign(new ChatSession(), { messages: [] }));
    await settle(shadowRootOf(el));
    const button = mustQuery(shadowRootOf(el), "button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("emits hive-send-message with the composed text on Enter", async () => {
    const el = await mount(Object.assign(new ChatSession(), { messages: [] }));
    await settle(shadowRootOf(el));
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-send-message", resolve as EventListener, {
        once: true,
      })
    );
    const input = mustQuery(shadowRootOf(el), "input") as HTMLInputElement;
    type(input, "hello");
    await el.updateComplete;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
      })
    );
    const event = await emitted;
    expect(event.detail).toEqual({ content: "hello" });
  });
});
