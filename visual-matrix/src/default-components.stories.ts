/** The default (fallback) flow components — the generic surface every flow
 * without a custom UI renders, and the degraded path when a served component
 * module fails to load. They render in the hive app shell's token context
 * (no expedition chrome), so their matrix is light/dark × widths via the
 * `withMode` decorator. Component behaviour itself stays with the jsdom
 * component tests; these stories exist for the visual contract. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { ChatSession } from "ui/flow-rendering/components/chat-session";
import { WorkflowBoardContent } from "ui/flow-rendering/components/workflow-board-content";
// The default components are defined at module import (the served host's
// registration path), so the imports here both load and register them.
import { WorkflowInstanceCard } from "ui/flow-rendering/components/workflow-instance-card";
import { action, cardDef, entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import type { ChatMessage } from "workflow-engine/shared/chat-message";
import type { VisibleAction } from "workflow-engine/workflow-types";
import {
  type ModeArgs,
  modeArgTypes,
  modeOnlyArgs,
  modeOnlyMatrix,
  withMode,
} from "./expedition-chrome.ts";

const meta = {
  title: "Default flow components",
  decorators: [withMode],
  args: modeOnlyArgs,
  argTypes: modeArgTypes,
  parameters: { percy: { additionalSnapshots: modeOnlyMatrix } },
} satisfies Meta<ModeArgs>;

export default meta;
type Story = StoryObj<ModeArgs>;

// ── fixtures (fixed ids; the generic cards workflow shape) ─────────────────

const cardsDef = cardDef({
  ui: {
    view: "board",
    columns: [
      { id: "ready", label: "Ready", states: ["ready"] },
      { id: "in_progress", label: "In Progress", states: ["in_progress"] },
      { id: "done", label: "Done", states: ["done"] },
    ],
  },
});

function cardInstance(
  id: string,
  currentState: string,
  fields: Record<string, unknown> = {},
  actions: VisibleAction[] = []
): WorkflowInstanceEntry {
  const instance = entry(id, currentState);
  instance.state.workflowInstanceState = fields;
  instance.availableActions = actions;
  return instance;
}

const claimActions = [
  action("claim", "Claim", "primary"),
  action("rule_out", "Rule out", "secondary"),
];

// ── workflow-instance-card ─────────────────────────────────────────────────

function instanceCard(options: {
  instance: WorkflowInstanceEntry;
  compact?: boolean;
}) {
  const card = new WorkflowInstanceCard();
  Object.assign(card, {
    workflowDef: cardsDef,
    instanceEntry: options.instance,
    customKinds: [],
    compact: options.compact === true,
    onAction() {},
    onSendMessage: async () => {},
  });
  return card;
}

/** The default instance card: a ready card with its action affordances. */
export const InstanceCard: Story = {
  name: "instance card (ready)",
  render: () =>
    html`<div style="width: 360px">
      ${instanceCard({
        instance: cardInstance(
          "card-ready",
          "ready",
          { cardSpec: { title: "Pick the failover policy" } },
          claimActions
        ),
      })}
    </div>`,
};

/** The compact face (the collapsed card the dense surfaces render). */
export const InstanceCardCompact: Story = {
  name: "instance card (compact)",
  render: () =>
    html`<div style="width: 280px">
      ${instanceCard({
        instance: cardInstance("card-compact", "in_progress", {
          cardSpec: { title: "Patch the backoff" },
        }),
        compact: true,
      })}
    </div>`,
};

// ── workflow-board-content ─────────────────────────────────────────────────

/** The canonical board the generic workflow sections compose: the fixture
 * entries across the three columns. */
export const Board: Story = {
  name: "board content",
  render: () => {
    const board = new WorkflowBoardContent();
    Object.assign(board, {
      workflowDef: cardsDef,
      entries: [
        cardInstance(
          "board-ready-1",
          "ready",
          { cardSpec: { title: "Pick the failover policy" } },
          claimActions
        ),
        cardInstance("board-ready-2", "ready", {
          cardSpec: { title: "Sketch the retry console" },
        }),
        cardInstance("board-active-1", "in_progress", {
          cardSpec: { title: "Patch the backoff" },
        }),
        cardInstance("board-done-1", "done", {
          cardSpec: { title: "Read the proxy logs" },
        }),
      ],
      customKinds: [],
      onAction() {},
      onSendMessage: async () => {},
      onPatchState() {},
    });
    return html`${board}`;
  },
};

// ── chat-session ───────────────────────────────────────────────────────────

const chatTranscript: ChatMessage[] = [
  { role: "user", content: "What should the expedition name be?" },
  {
    role: "assistant",
    content: 'I suggest "Router resilience" — it names the destination.',
  },
  { role: "user", content: "Go with that." },
];

/** A live interactive chat session (the naming/frontier session face). */
export const ChatLive: Story = {
  name: "chat session (live)",
  render: () => {
    const chat = new ChatSession();
    Object.assign(chat, {
      sessionId: "chat-story-live",
      messages: chatTranscript,
      interactive: true,
      thinking: false,
    });
    return html`<div style="width: 420px">${chat}</div>`;
  },
};

/** The composing state: the thinking indicator where the reply will land. */
export const ChatThinking: Story = {
  name: "chat session (thinking)",
  render: () => {
    const chat = new ChatSession();
    Object.assign(chat, {
      sessionId: "chat-story-thinking",
      messages: chatTranscript,
      interactive: true,
      thinking: true,
    });
    return html`<div style="width: 420px">${chat}</div>`;
  },
};

/** The read-only face (a one-shot agent's transcript: no input row). */
export const ChatReadOnly: Story = {
  name: "chat session (read-only)",
  render: () => {
    const chat = new ChatSession();
    Object.assign(chat, {
      sessionId: "chat-story-readonly",
      messages: chatTranscript,
      interactive: false,
      thinking: false,
    });
    return html`<div style="width: 420px">${chat}</div>`;
  },
};
