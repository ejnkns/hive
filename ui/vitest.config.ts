import { defineConfig } from "vitest/config";

// Component-level behavioral tests for the Lit rendering surface. These mount
// real custom elements in a DOM environment (jsdom) — the pure-function layer
// stays on `node --test` (src/**/*.test.ts); this runner covers the components
// (src/**/*.component.test.ts).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.component.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
