/** The in-context detail drawer (wayfinder-drawer) open states: what the
 * drawer renders for a frontier ticket, a fog brief, an active research run,
 * a closed decision's record, a build item, and the charting anchor (standing
 * notes plus the persisted map document). Details derive through the REAL
 * view-model seam (deriveDrawerDetail) over the shared fixed-id fixtures. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { createWayfinderDrawer } from "presets/wayfinder/ui/wayfinder-drawer";
import {
  type DrawerDetail,
  deriveDrawerDetail,
} from "presets/wayfinder/ui/wayfinder-drawer-model";
import { deriveWayfinderMap } from "presets/wayfinder/ui/wayfinder-map";
import {
  expeditionModeSet,
  type MatrixArgs,
  withExpedition,
} from "./expedition-chrome.ts";
import { registerServedModule } from "./flow-deps.ts";
import { mixedShape } from "./story-shapes.ts";
import { MAP_DOCUMENT, wayfinderDefs } from "./wayfinder-props.ts";

const Drawer = registerServedModule((deps) => ({
  components: { "wayfinder-drawer": createWayfinderDrawer(deps) },
}))["wayfinder-drawer"];

const entries = mixedShape();
const model = deriveWayfinderMap(entries);

function drawerDetail(selectedId: string): DrawerDetail {
  const detail = deriveDrawerDetail({
    selectedId,
    model,
    entries,
    workflowDefs: wayfinderDefs(),
    persistedOutputDirs: { decisions: { "ticket-decision.md": "# Decision" } },
    persistedOutputs: { "map.md": MAP_DOCUMENT },
  });
  if (detail === undefined) {
    throw new Error(`fixture id ${selectedId} is not a map node`);
  }
  return detail;
}

function drawerPanel(selectedId: string) {
  const panel = new Drawer();
  Object.assign(panel, {
    detail: drawerDetail(selectedId),
    onClose() {},
    onNavigate() {},
    onAction() {},
    onSendMessage: async () => {},
  });
  return panel;
}

// The drawer positions itself absolutely against its nearest positioned
// ancestor (the map body in the shell); the story stage stands in for it.
function drawer(selectedId: string) {
  return html`<div style="position: relative; width: 100%; height: 560px">
    ${drawerPanel(selectedId)}
  </div>`;
}

const meta = {
  title: "Wayfinder/Drawer",
  decorators: [withExpedition],
  parameters: { chromatic: { modes: expeditionModeSet } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

/** A frontier ticket: presentation status, the question, the closed blocker
 * reference, and its claim affordances. */
export const FrontierTicket: Story = {
  name: "frontier ticket",
  render: () => html`${drawer("ticket-frontier")}`,
};

/** A fog ticket: the unclarified brief and the graduate/rule-out affordances. */
export const FogTicket: Story = {
  name: "fog ticket",
  render: () => html`${drawer("ticket-fog")}`,
};

/** An active research run: the live resolution task output. */
export const ActiveResearch: Story = {
  name: "active research",
  render: () => html`${drawer("ticket-resolving")}`,
};

/** A closed decision: the persisted decision record from the decisions
 * output dir. */
export const DecisionRecord: Story = {
  name: "closed decision",
  render: () => html`${drawer("ticket-decision")}`,
};

/** A build item mid-flight: planner tickets, review findings, branch data. */
export const BuildItem: Story = {
  name: "build item",
  render: () => html`${drawer("build-item-1")}`,
};

/** The charting anchor: the destination's standing notes and the persisted
 * map document (map.md). */
export const ChartingAnchor: Story = {
  name: "charting anchor",
  render: () => html`${drawer("base")}`,
};

/** The reduced-motion review slot for the drawer (its slide/settle
 * transitions): the content a reduced-motion user gets. */
export const ReducedMotion: Story = {
  name: "frontier ticket (reduced motion)",
  parameters: { expedition: { reducedMotion: true } },
  render: () => html`${drawer("ticket-frontier")}`,
};
