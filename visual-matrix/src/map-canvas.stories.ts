/** The map surface (map-canvas) close-up: the constellation with its node
 * overlays across the matrix. The canvas content is deterministic here — the
 * fixture id space fixes the layout seed, and the shared decorator emulates
 * reduced motion so the twinkle layer freezes and the camera snaps. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { createMapCanvas } from "presets/wayfinder/ui/map-canvas";
import { deriveWayfinderMap } from "presets/wayfinder/ui/wayfinder-map";
import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import {
  expeditionArgs,
  expeditionArgTypes,
  expeditionMatrix,
  type MatrixArgs,
  storyStage,
  withExpedition,
} from "./expedition-chrome.ts";
import { registerServedModule } from "./flow-deps.ts";
import { snapshotShape } from "./story-shapes.ts";

const MapCanvas = registerServedModule((deps) => ({
  components: { "wayfinder-map-view": createMapCanvas(deps) },
}))["wayfinder-map-view"];

function mapCanvas(options: {
  shape: Parameters<typeof snapshotShape>[0];
  theme: ExpeditionTheme;
}) {
  const entries = snapshotShape(options.shape);
  const canvas = new MapCanvas();
  Object.assign(canvas, {
    model: deriveWayfinderMap(entries),
    theme: options.theme,
    revision: 7,
  });
  return canvas;
}

const meta = {
  title: "Wayfinder/Map canvas",
  decorators: [withExpedition],
  args: expeditionArgs,
  argTypes: expeditionArgTypes,
  parameters: { percy: { additionalSnapshots: expeditionMatrix } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

/** The node overlays over the mixed lifecycle constellation: fog, frontier,
 * blocked, active, decision, out-of-scope, base, summit, build legs. */
export const Mixed: Story = {
  name: "node overlays (mixed)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(html`${mapCanvas({ shape: "mixed", theme: theme })}`, 560),
};

export const FogHeavy: Story = {
  name: "node overlays (fog-heavy)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(html`${mapCanvas({ shape: "fog-heavy", theme: theme })}`, 560),
};

export const DependencyHeavy: Story = {
  name: "node overlays (dependency-heavy)",
  render: ({ theme }: MatrixArgs) =>
    storyStage(
      html`${mapCanvas({
        shape: "dependency-heavy",
        theme: theme,
      })}`,
      560
    ),
};

/** The reduced-motion review slot for the map surface: the frozen twinkle
 * and snapped camera a reduced-motion user gets, reviewed in Percy like any
 * other snapshot. */
export const ReducedMotion: Story = {
  name: "node overlays (reduced motion)",
  parameters: { expedition: { reducedMotion: true } },
  render: ({ theme }: MatrixArgs) =>
    storyStage(html`${mapCanvas({ shape: "mixed", theme: theme })}`, 560),
};
