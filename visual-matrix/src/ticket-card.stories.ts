/** The served ticket card (ticket-card): one story per lifecycle position —
 * fog, frontier, blocked, active research, closed, out-of-scope — the cards
 * the table workbench's stations and the generic board render. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import ticketCardModule from "presets/wayfinder/ui/ticket-card";
import {
  expeditionArgs,
  expeditionArgTypes,
  expeditionMatrix,
  type MatrixArgs,
  withExpedition,
} from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import {
  claimAction,
  instanceCardProps,
  ticketEntry,
  wayfinderDef,
} from "./wayfinder-props.ts";

const TicketCard = servedComponent(ticketCardModule, "ticket-card");
const ticketDef = wayfinderDef("ticket");

function ticketCard(
  id: string,
  currentState: string,
  fields: Record<string, unknown> = {},
  dependencies?: Parameters<typeof ticketEntry>[3],
  actions?: Parameters<typeof ticketEntry>[4]
) {
  const card = new TicketCard();
  Object.assign(
    card,
    instanceCardProps({
      def: ticketDef,
      entry: ticketEntry(id, currentState, fields, dependencies, actions),
    })
  );
  return card;
}

const meta = {
  title: "Wayfinder/Ticket card",
  decorators: [withExpedition],
  args: expeditionArgs,
  argTypes: expeditionArgTypes,
  parameters: { percy: { additionalSnapshots: expeditionMatrix } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

export const Fog: Story = {
  name: "fog",
  render: () =>
    html`${ticketCard("ticket-fog-card", "fog", {
      brief: "Do metrics survive the proxy restart?",
    })}`,
};

export const Frontier: Story = {
  name: "frontier",
  render: () =>
    html`${ticketCard(
      "ticket-frontier-card",
      "ready",
      {
        title: "Pick the failover policy",
        question: "Circuit-breaker half-open or cooldown-first?",
        type: "research",
      },
      { blockers: [], unsatisfied: [] },
      [claimAction]
    )}`,
};

export const Blocked: Story = {
  name: "blocked",
  render: () =>
    html`${ticketCard(
      "ticket-blocked-card",
      "ready",
      {
        title: "Sketch the retry console",
        question: "Where does the retry console live?",
        type: "prototype",
      },
      { blockers: ["ticket-fog"], unsatisfied: ["ticket-fog"] }
    )}`,
};

export const Active: Story = {
  name: "active (research)",
  render: () =>
    html`${ticketCard("ticket-active-card", "resolving_research", {
      title: "Grill the provider seam",
      question: "Which provider errors are retryable?",
      type: "research",
    })}`,
};

export const Closed: Story = {
  name: "closed",
  render: () =>
    html`${ticketCard("ticket-closed-card", "closed", {
      title: "Concurrency-first pilots",
    })}`,
};

export const OutOfScope: Story = {
  name: "out of scope",
  render: () =>
    html`${ticketCard("ticket-out-card", "out_of_scope", {
      title: "Rewrite the router",
    })}`,
};
