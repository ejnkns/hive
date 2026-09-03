import type { Preview } from "@storybook/web-components-vite";
// The app's theme-token source: the served surfaces' utility classes and
// component css read --bg/--card/--surface/--text/... which are defined here
// (dark on :root, light on html.light) exactly as the served host provides
// them. Importing the real stylesheet keeps the storybook matrix on the
// token values the app ships, not a copy.
import "ui/app.css";

const preview: Preview = {
  parameters: {
    // Percy freezes CSS animations itself (disableCssAnimations defaults to
    // true); the JS-side reduced-motion seam (the map controller's
    // matchMedia read) is emulated per story by the shared expedition
    // decorator, defaulting to on so every canvas-bearing snapshot is
    // deterministic. See src/expedition-chrome.ts.
    expedition: { reducedMotion: true },
  },
};

export default preview;
