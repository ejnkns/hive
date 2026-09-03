/** The cartographer's table workbench (wayfinder-table) close-up: the
 * stations — fog pile, frontier, resolving, closed decisions journal,
 * out-of-scope, builds — with the themed mini-map card. The fog-heavy and
 * dependency-heavy shapes exercise the blocked/frontier split and the drag
 * pile's render (the drag interaction itself stays with the e2e suite). */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { deriveWayfinderMap } from "presets/wayfinder/ui/wayfinder-map";
import { createWayfinderTable } from "presets/wayfinder/ui/wayfinder-table";
import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import {
  expeditionModeSet,
  type MatrixArgs,
  withExpedition,
} from "./expedition-chrome.ts";
import { registerServedModule } from "./flow-deps.ts";
import { snapshotShape } from "./story-shapes.ts";
import { MAP_DOCUMENT, wayfinderDefs } from "./wayfinder-props.ts";

const Table = registerServedModule((deps) => ({
  components: { "wayfinder-table": createWayfinderTable(deps) },
}))["wayfinder-table"];

function table(
  shape: Parameters<typeof snapshotShape>[0],
  theme: ExpeditionTheme
) {
  const entries = snapshotShape(shape);
  const workbench = new Table();
  Object.assign(workbench, {
    model: deriveWayfinderMap(entries),
    theme,
    entries,
    workflowDefs: wayfinderDefs(),
    persistedOutputs: { "map.md": MAP_DOCUMENT },
    persistedOutputDirs: { decisions: { "ticket-decision.md": "# Decision" } },
    fogOrder: [],
    onAction() {},
    onSendMessage: async () => {},
    onHover() {},
    onFocus() {},
    onFogOrderChange() {},
    onViewChange() {},
  });
  return workbench;
}

const meta = {
  title: "Wayfinder/Table workbench",
  decorators: [withExpedition],
  parameters: { chromatic: { modes: expeditionModeSet } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

/** The full workbench over the mixed lifecycle baseline. */
export const Mixed: Story = {
  name: "workbench (mixed)",
  render: ({ theme }: MatrixArgs) => html`${table("mixed", theme)}`,
};

/** The fog station's pile and the frontier/blocked split. */
export const FogHeavy: Story = {
  name: "workbench (fog-heavy)",
  render: ({ theme }: MatrixArgs) => html`${table("fog-heavy", theme)}`,
};

/** The blocker chain: ready tickets presenting as blocked until their
 * blockers close. */
export const DependencyHeavy: Story = {
  name: "workbench (dependency-heavy)",
  render: ({ theme }: MatrixArgs) => html`${table("dependency-heavy", theme)}`,
};

/** The build legs: build container and build-item cards mid-flight. */
export const BuildMix: Story = {
  name: "workbench (build mix)",
  render: ({ theme }: MatrixArgs) => html`${table("build-mix", theme)}`,
};
