import type { StorybookConfig } from "@storybook/web-components-vite";

// The visual matrix: Storybook (Lit + Vite) over the served flow surfaces.
// Stories are snapshotted by Percy (`percy storybook ./storybook-build`) —
// see docs/decisions/2026-09-01-visual-testing-storybook-percy.md.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/web-components-vite",
  addons: ["@storybook/addon-a11y"],
};

export default config;
