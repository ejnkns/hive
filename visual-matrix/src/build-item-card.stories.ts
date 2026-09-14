/** The served build-item card (build-item-card): one fanned-out build ticket
 * at its lifecycle positions — ready, working, review, merged. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import buildItemCardModule from "presets/wayfinder/ui/build-item-card";
import { entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import { modeOnlyModeSet, withExpedition } from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import { instanceCardProps, wayfinderDef } from "./wayfinder-props.ts";

const BuildItemCard = servedComponent(buildItemCardModule, "build-item-card");
const buildItemDef = wayfinderDef("buildItem");

function buildItemCard(
  id: string,
  currentState: string,
  fields: Record<string, unknown> = {}
) {
  const item: WorkflowInstanceEntry = entry(id, currentState);
  item.workflowId = "buildItem";
  item.state.workflowInstanceState = {
    ticket: {
      title: "Retry loop",
      description: "Retry the router with backoff.",
      acceptanceCriteria: ["Retries are bounded"],
      ...fields,
    },
    dependsOn: [],
  };
  const card = new BuildItemCard();
  Object.assign(card, instanceCardProps({ def: buildItemDef, entry: item }));
  return card;
}

const meta = {
  title: "Wayfinder/Build item card",
  decorators: [withExpedition],
  parameters: { chromatic: { modes: modeOnlyModeSet } },
} satisfies Meta<{ mode: "dark" | "light" }>;

export default meta;
type Story = StoryObj<{ mode: "dark" | "light" }>;

export const Ready: Story = {
  name: "ready",
  render: () => html`${buildItemCard("build-item-card-ready", "ready")}`,
};

export const Working: Story = {
  name: "working",
  render: () => html`${buildItemCard("build-item-card-working", "working")}`,
};

export const Merged: Story = {
  name: "merged",
  render: () => html`${buildItemCard("build-item-card-merged", "merged")}`,
};
