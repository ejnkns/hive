/** The Base Camp empty state (base-camp): what a newly created flow presents
 * before its first content node exists — destination prompt, flow actions,
 * and the standing invitation into the map. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { createBaseCamp } from "presets/wayfinder/ui/base-camp";
import { deriveWayfinderMap } from "presets/wayfinder/ui/wayfinder-map";
import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import {
  expeditionModeSet,
  type MatrixArgs,
  storyStage,
  withExpedition,
} from "./expedition-chrome.ts";
import { registerServedModule } from "./flow-deps.ts";
import { emptyShape } from "./story-shapes.ts";
import { wayfinderFlowActions } from "./wayfinder-props.ts";

const BaseCamp = registerServedModule((deps) => ({
  components: { "wayfinder-base-camp": createBaseCamp(deps) },
}))["wayfinder-base-camp"];

function baseCamp(theme: ExpeditionTheme) {
  const entries = emptyShape();
  const camp = new BaseCamp();
  Object.assign(camp, {
    flowLabel: "Router resilience",
    flowStatus: "idle",
    model: deriveWayfinderMap(entries),
    theme,
    entries,
    workflowDefs: [],
    availableFlowActions: wayfinderFlowActions,
    onAction() {},
    onSendMessage: async () => {},
    onCreate() {},
    onFlowAction() {},
    onViewChange() {},
  });
  return camp;
}

const meta = {
  title: "Wayfinder/Base camp",
  decorators: [withExpedition],
  parameters: { chromatic: { modes: expeditionModeSet } },
} satisfies Meta<MatrixArgs>;

export default meta;
type Story = StoryObj<MatrixArgs>;

export const Empty: Story = {
  name: "empty expedition",
  render: ({ theme }: MatrixArgs) => storyStage(html`${baseCamp(theme)}`, 480),
};
