/** The served wayfinder flow surface (flow-component): the map-first shell
 * with its HUD, the Base Camp empty state, and the cartographer's table
 * workbench, across the theme × light/dark matrix (Percy widths give the
 * narrow/medium/wide axis). These stories render the REAL expedition chrome
 * — the component owns it — so they are the drift reference for the
 * harness-chrome component stories beside them. The theme arg IS the flow's
 * static config (`expeditionTheme`), so the control re-themes the whole
 * surface exactly as the served host does. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import flowComponentModule from "presets/wayfinder/ui/flow-component";
import {
  expeditionArgs,
  expeditionArgTypes,
  expeditionMatrix,
  type MatrixArgs,
  storyStage,
  withExpedition,
} from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import { snapshotShape } from "./story-shapes.ts";
import { flowSurfaceProps, MAP_DOCUMENT } from "./wayfinder-props.ts";

const flowComponent = servedComponent(flowComponentModule, "flow-component");

function flowSurface(options: Parameters<typeof flowSurfaceProps>[0]) {
  const surface = new flowComponent();
  // The restore of the surface's durable view state (empty in a story) runs
  // in willUpdate, once, after this whole sync assignment — so an explicit
  // view override in the same tick always survives.
  Object.assign(
    surface,
    flowSurfaceProps(options),
    options.view === undefined ? {} : { view: options.view }
  );
  return surface;
}

const meta = {
  title: "Wayfinder/Flow surface",
  decorators: [withExpedition],
  args: expeditionArgs,
  argTypes: expeditionArgTypes,
  parameters: { percy: { additionalSnapshots: expeditionMatrix } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

/** The populated expedition at its default: the map-first shell with the HUD
 * over the mixed lifecycle constellation. */
export const Mixed: Story = {
  name: "map shell (mixed)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-mixed",
        entries: snapshotShape("mixed"),
        theme,
        persistedOutputs: { "map.md": MAP_DOCUMENT },
      })}`,
      560
    ),
};

/** Every snapshot shape of the map surface: empty charting (Base Camp), the
 * fog pile, a blocker chain, active, resolved, out-of-scope, and the
 * build/build-item mix. Base themes: mountain dark (the matrix multiplies). */
export const Empty: Story = {
  name: "base camp (empty)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-empty",
        entries: snapshotShape("empty"),
        theme,
      })}`,
      560
    ),
};

export const FogHeavy: Story = {
  name: "map shell (fog-heavy)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-fog-heavy",
        entries: snapshotShape("fog-heavy"),
        theme,
      })}`,
      560
    ),
};

export const DependencyHeavy: Story = {
  name: "map shell (dependency-heavy)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-dependency-heavy",
        entries: snapshotShape("dependency-heavy"),
        theme,
      })}`,
      560
    ),
};

export const Active: Story = {
  name: "map shell (active)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-active",
        entries: snapshotShape("active"),
        theme,
      })}`,
      560
    ),
};

export const Resolved: Story = {
  name: "map shell (resolved)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-resolved",
        entries: snapshotShape("resolved"),
        theme,
      })}`,
      560
    ),
};

export const OutOfScope: Story = {
  name: "map shell (out-of-scope)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-out-of-scope",
        entries: snapshotShape("out-of-scope"),
        theme,
      })}`,
      560
    ),
};

export const BuildMix: Story = {
  name: "map shell (build mix)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-build-mix",
        entries: snapshotShape("build-mix"),
        theme,
      })}`,
      560
    ),
};

/** The cartographer's table workbench (the persisted table mode). */
export const Table: Story = {
  name: "table workbench (mixed)",
  render: ({ theme }: MatrixArgs) =>
    html`${flowSurface({
      flowId: "story-table-mixed",
      entries: snapshotShape("mixed"),
      view: "table",
      theme,
      persistedOutputs: { "map.md": MAP_DOCUMENT },
    })}`,
};

/** The reduced-motion review slot for the animated surface (the map): what a
 * reduced-motion user gets — the camera snapped, the twinkle frozen, no
 * entrance marks. The emulation rides the same matchMedia seam the controller
 * reads (see expedition-chrome.ts / reduced-motion.ts); every other map story
 * renders under the same emulation so its canvas is deterministic. */
export const ReducedMotion: Story = {
  name: "map shell (reduced motion)",
  parameters: { expedition: { reducedMotion: true } },
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${flowSurface({
        flowId: "story-map-reduced",
        entries: snapshotShape("mixed"),
        theme,
      })}`,
      560
    ),
};
