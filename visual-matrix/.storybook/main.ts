import type { StorybookConfig } from "@storybook/web-components-vite";

// The visual matrix: Storybook (Lit + Vite) over the served flow surfaces.
// Stories are snapshotted by Chromatic (visual-matrix/chromatic.config.json)
// — see docs/decisions/2026-09-03-visual-testing-chromatic-replaces-percy.md.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/web-components-vite",
  addons: ["@storybook/addon-a11y"],
};

export default config;
