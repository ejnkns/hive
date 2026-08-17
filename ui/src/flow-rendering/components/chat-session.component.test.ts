import { describe, expect, it } from "vitest";
import type { ChatMessage } from "workflow-engine/workflow-types";
import {
  mount,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils.ts";
import { ChatSession } from "./chat-session.ts";

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
  it("pins to the bottom on new messages but preserves an upward scroll", async () => {
    const el = await mount(
      Object.assign(new ChatSession(), {
        messages: messages.slice(0, 2),
        sessionId: "s1",
        interactive: true,
      })
    );
    await settle(shadowRootOf(el));
    const scroll = mustQuery(shadowRootOf(el), ".scroll") as HTMLElement;

    // Layout metrics jsdom cannot compute; stub them.
    Object.defineProperty(scroll, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scroll, "clientHeight", {
      value: 200,
      configurable: true,
    });

    // The user scrolls up to read history; a scroll event records the
    // position as unpinned.
    scroll.scrollTop = 300;
    scroll.dispatchEvent(new Event("scroll"));

    // New content arrives — the position is preserved, not yanked to bottom.
    el.messages = messages;
    await el.updateComplete;
    expect(scroll.scrollTop).toBe(300);

    // Back at the bottom, new content auto-scrolls down.
    scroll.scrollTop = scroll.scrollHeight;
    scroll.dispatchEvent(new Event("scroll"));
    el.messages = [
      ...messages,
      { role: "assistant", content: "more", tool_calls: undefined },
    ];
    await el.updateComplete;
    expect(scroll.scrollTop).toBe(scroll.scrollHeight);
  });

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
    const el = await mount(
      Object.assign(new ChatSession(), { messages: [], interactive: true })
    );
    await settle(shadowRootOf(el));
    const button = mustQuery(shadowRootOf(el), "button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("hides the input row for read-only (one-shot) sessions", async () => {
    const interactive = await mount(
      Object.assign(new ChatSession(), { messages: [], interactive: true })
    );
    await settle(shadowRootOf(interactive));
    expect(
      shadowRootOf(interactive).querySelector(".input-row")
    ).not.toBeNull();

    const readOnly = await mount(
      Object.assign(new ChatSession(), { messages: [], interactive: false })
    );
    await settle(shadowRootOf(readOnly));
    expect(shadowRootOf(readOnly).querySelector(".input-row")).toBeNull();
  });

  it("emits hive-send-message with the composed text on Enter", async () => {
    const el = await mount(
      Object.assign(new ChatSession(), { messages: [], interactive: true })
    );
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
