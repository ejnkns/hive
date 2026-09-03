/** The served build card (build-card): the implementation-phase container —
 * specing, planned (spec recorded), proposed, accepted — the card the table
 * workbench's build station renders. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import buildCardModule from "presets/wayfinder/ui/build-card";
import { entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import { modeOnlyModeSet, withExpedition } from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import { instanceCardProps, wayfinderDef } from "./wayfinder-props.ts";

const BuildCard = servedComponent(buildCardModule, "build-card");
const buildDef = wayfinderDef("build");

function buildCard(id: string, currentState: string, spec: string) {
  const build: WorkflowInstanceEntry = entry(id, currentState);
  build.workflowId = "build";
  build.state.workflowInstanceState = { spec };
  const card = new BuildCard();
  Object.assign(card, instanceCardProps({ def: buildDef, entry: build }));
  return card;
}

const meta = {
  title: "Wayfinder/Build card",
  decorators: [withExpedition],
  parameters: { chromatic: { modes: modeOnlyModeSet } },
} satisfies Meta<{ mode: "dark" | "light" }>;

export default meta;
type Story = StoryObj<{ mode: "dark" | "light" }>;

export const Planned: Story = {
  name: "planned",
  render: () =>
    html`${buildCard(
      "build-card-planned",
      "planned",
      "# Spec\n\nFailover first, then the retry console."
    )}`,
};

export const Proposed: Story = {
  name: "proposed",
  render: () =>
    html`${buildCard(
      "build-card-proposed",
      "proposed",
      "# Spec\n\nThe plan proposes three build items."
    )}`,
};

export const Accepted: Story = {
  name: "accepted",
  render: () =>
    html`${buildCard(
      "build-card-accepted",
      "accepted",
      "# Spec\n\nAll build items merged."
    )}`,
};
