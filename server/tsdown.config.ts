import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  deps: {
    alwaysBundle: [/^(shared|telemetry|workflow-engine)(\/|$)/],
    // The schema-consistency check and per-definition typechecker import
    // typescript at runtime; it must stay a bare import (Node resolves it
    // from node_modules as CJS) — bundling it into the ESM output breaks its
    // `__filename`-using sys code.
    neverBundle: ["typescript"],
  },
  dts: true,
  sourcemap: true,
  clean: true,
  banner: "#!/usr/bin/env node",
});
