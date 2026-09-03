/** The served charting card (charting-card): the charting session's
 * lifecycle — the idle session, the live naming/frontier chat session (the
 * interactive ai-chat context), and the charted state. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import chartingCardModule from "presets/wayfinder/ui/charting-card";
import { entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import {
  expeditionArgs,
  modeOnlyMatrix,
  themeInertArgTypes,
  withExpedition,
} from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import { instanceCardProps, wayfinderDef } from "./wayfinder-props.ts";

const ChartingCard = servedComponent(chartingCardModule, "charting-card");
const chartingDef = wayfinderDef("charting");

function chartingCard(options: {
  id: string;
  currentState: string;
  destination?: string;
  notes?: string;
  runningChat?: boolean;
}) {
  const charting: WorkflowInstanceEntry = entry(
    options.id,
    options.currentState
  );
  charting.workflowId = "charting";
  charting.state.workflowInstanceState = {
    ...(options.destination !== undefined
      ? { destination: options.destination }
      : {}),
    ...(options.notes !== undefined ? { notes: options.notes } : {}),
  };
  if (options.runningChat === true) {
    charting.state.hasRunningTask = true;
    charting.state.runningTaskContext = {
      role: "ai-chat",
      sessionId: `${options.id}-chat`,
      interactive: true,
      messages: [
        { role: "assistant", content: "What should the expedition name be?" },
        { role: "user", content: "Router resilience." },
      ],
    };
  }
  const card = new ChartingCard();
  Object.assign(card, instanceCardProps({ def: chartingDef, entry: charting }));
  return card;
}

const meta = {
  title: "Wayfinder/Charting card",
  decorators: [withExpedition],
  args: expeditionArgs,
  argTypes: themeInertArgTypes,
  parameters: { percy: { additionalSnapshots: modeOnlyMatrix } },
} satisfies Meta<{ mode: "dark" | "light" }>;

export default meta;
type Story = StoryObj<{ mode: "dark" | "light" }>;

/** Empty charting: the session before a destination is named. */
export const Empty: Story = {
  name: "empty charting",
  render: () =>
    html`${chartingCard({ id: "charting-card-empty", currentState: "naming" })}`,
};

/** The live naming session: the interactive chat transcript. */
export const LiveChat: Story = {
  name: "live chat session",
  render: () =>
    html`${chartingCard({
      id: "charting-card-chat",
      currentState: "naming",
      runningChat: true,
    })}`,
};

/** The charted session: destination recorded, standing notes present. */
export const Charted: Story = {
  name: "charted",
  render: () =>
    html`${chartingCard({
      id: "charting-card-charted",
      currentState: "charted",
      destination: "Router resilience",
      notes: "offline-first, provider failover",
    })}`,
};
