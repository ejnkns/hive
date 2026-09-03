import type { Preview } from "@storybook/web-components-vite";
// The matrix axes (theme toolbar values, mode values, named viewports) come
// from the shared matrix module so the globalTypes, the viewport options,
// and the Chromatic mode sets cannot drift apart.
import {
  expeditionModesList,
  expeditionThemes,
  expeditionViewports,
} from "../src/expedition-chrome.ts";
// The app's theme-token source: the served surfaces' utility classes and
// component css read --bg/--card/--surface/--text/... which are defined here
// (dark on :root, light on html.light) exactly as the served host provides
// them. Importing the real stylesheet keeps the storybook matrix on the
// token values the app ships, not a copy.
import "ui/app.css";

const preview: Preview = {
  // The matrix axes are globals so Chromatic's modes can address them (a
  // mode is a named globals combination); the decorators bridge them onto
  // the typed args the story renders consume (see expedition-chrome.ts).
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Expedition theme (the wayfinder --wf-* variable set)",
      defaultValue: "mountain",
      toolbar: {
        icon: "paintbrush",
        items: expeditionThemes.map((theme) => ({
          value: theme,
          title: theme,
        })),
        title: "Theme",
      },
    },
    mode: {
      name: "Mode",
      description: "Light/dark mode (served components key off html.light)",
      defaultValue: "dark",
      toolbar: {
        icon: "mirror",
        items: expeditionModesList.map((mode) => ({
          value: mode,
          title: mode,
        })),
        title: "Mode",
      },
    },
  },
  parameters: {
    // The width axis of the matrix: named viewports the Chromatic mode
    // globals reference. Chromatic also pauses CSS animations natively and
    // (unlike the JS seam below) runs its own standardized browser — the
    // JS-side reduced-motion seam stays because the canvas twinkle and the
    // map controller's read-once matchMedia are not reachable from a
    // capture config.
    viewport: { options: expeditionViewports, defaultViewport: "wide" },
    // The JS-side reduced-motion seam (the map controller's matchMedia
    // read) is emulated per story by the shared expedition decorator,
    // defaulting to on so every canvas-bearing snapshot is deterministic.
    // See src/expedition-chrome.ts.
    expedition: { reducedMotion: true },
  },
};

export default preview;
